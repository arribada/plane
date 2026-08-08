# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Periodic GitHub -> Plane ingestion. Pulls OPEN issues from the GitHub repos the
# team has mapped to projects (ProjectWikiDoc.github_repo_urls), or an explicit
# GITHUB_SYNC_REPOS allowlist, and records every one of them in the GithubIssue
# table keyed on (workspace, repo, number) — so re-runs update instead of
# duplicating.
#
# It also reconciles the other direction: an issue that has been CLOSED on GitHub
# stops being work here. The row is marked closed so it leaves the triage queue,
# and the work item it became is moved to its project's done state. See the
# "Closure reconciliation" block further down for how that is detected without
# downloading every closed issue in every repo every night.
#
# The inbox is that table now, not a project. It used to be the GHIN staging
# project, and this whole sync was a loop over `Project.objects.filter(
# identifier="GHIN")`: when GHIN was retired the loop body stopped executing and
# the sync went on running, on schedule, doing nothing at all. Nothing errored.
# So the capture no longer depends on any project existing — it is the one part
# that must always happen, because it is what the triage page reads.
#
# A work item is created only when exactly one project claims the repo. A repo
# nobody claims, or two projects claim, goes to the triage queue for a person to
# decide: guessing would file work under a project that never asked for it.
#
# Dormant unless GITHUB_PAT is set (then it also lights up the classification task
# and the Team-Hub activity feed, which read the same token). Scoped to mapped
# repos on purpose, so a first run can't flood the queue with every open org issue.

import os
from datetime import datetime
from datetime import timedelta

import requests
from celery import shared_task
from django.utils import timezone

from plane.arribada.task_safety import BASE, HTTP_RETRY_POLICY, task_lock

GITHUB_API = "https://api.github.com"

# Slightly under the every-30-minutes cadence, so a run that overruns holds the lock right up
# to the moment its successor is due and no further. Paired with `expire_seconds` on the beat
# entry in plane/celery.py: expiry stops a backlog being delivered, the lock stops whatever
# does get delivered from running twice at once.
SYNC_LOCK_SECONDS = 25 * 60


def _repo_claims():
    """owner/repo -> {project_id, ...}: every project that named the repo.

    Kept whole, contested repos included, because two callers need two different
    answers from the same scan: the router wants the repos exactly one project
    claims, and the triage queue wants to show a person WHICH projects are
    arguing over the rest so they can settle it.

    Live projects only. A wiki doc row is a plain model with a CASCADE that never
    fires, because Plane soft-deletes — so a deleted or archived project's row
    survives it and goes on voting. `_repo_workspaces` and the classification
    task each filter this out for themselves and each say why; `_repo_owners`
    did not, and its test is `len(owners) == 1`. A repo claimed by one live
    project and one retired one counted as contested and was never routed, so its
    issues sat in the triage queue for good; a repo claimed only by a retired one
    was reported as owned by a project the router then refused, so the run's own
    summary disagreed with what it did.

    Filtering here rather than in each caller because all three want the same
    answer, and two of them had already worked that out separately.
    """
    from plane.arribada.models import ProjectWikiDoc
    from plane.arribada.views import _github_url

    claims = {}
    for doc in (
        ProjectWikiDoc.objects.filter(
            project__deleted_at__isnull=True, project__archived_at__isnull=True
        )
        .exclude(github_repo_urls=[])
        .values_list("project_id", "github_repo_urls")
    ):
        project_id, urls = doc
        for url in urls or []:
            u = (_github_url(url) or str(url)).lower()
            parts = u.split("github.com/", 1)
            if len(parts) != 2:
                continue
            bits = parts[1].strip("/").split("/")
            if len(bits) < 2:
                continue
            repo = f"{bits[0]}/{bits[1]}".removesuffix(".git")
            claims.setdefault(repo, set()).add(project_id)
    return claims


def _repo_owners(claims=None):
    """owner/repo -> the project that linked it. Empty when nobody has linked one.

    The inbox was the only destination because nothing here knew where an issue
    belonged. Now that a project names its repos, most issues have an obvious home
    and routing them there is the difference between a queue somebody triages and
    a queue somebody ignores.

    A repo linked by TWO projects stays unrouted on purpose: guessing which one
    owns it would file work under a project that never asked for it, and the
    triage queue is exactly the right place for "a human has to decide".

    `claims` is accepted so a caller that already scanned can pass its result in;
    views.py calls this with no arguments and must keep working.
    """
    claims = _repo_claims() if claims is None else claims
    return {repo: next(iter(owners)) for repo, owners in claims.items() if len(owners) == 1}


def _repo_workspaces(repos, claims):
    """owner/repo -> the workspace its issues belong in, or None when unknowable.

    The workspace used to come from the GHIN project, which is how the whole sync
    ended up depending on GHIN existing. It is a property of the repo, not of any
    inbox: the projects that named a repo say which workspace cares about it, and
    even two projects fighting over one repo almost always sit in the same
    workspace — a contested claim is still a claim on a workspace.

    The last resort is "there is only one workspace here", which is true of every
    self-hosted install this runs on. Beyond that the honest answer is None: a
    GithubIssue row is keyed on a workspace, so an invented one would file real
    issues into a tenant that never asked for them. The caller reports the repos
    that land here rather than dropping them quietly, because a repo nobody can
    place is a mapping somebody has to fix, not a fact to hide.
    """
    from plane.db.models import Project, Workspace

    project_ids = {pid for owners in claims.values() for pid in owners}
    # Deleted and archived projects are excluded: their wiki doc rows survive a
    # soft delete, so a retired project would otherwise keep voting.
    ws_of_project = dict(
        Project.objects.filter(
            id__in=project_ids, archived_at__isnull=True
        ).values_list("id", "workspace_id")
    )

    only = list(Workspace.objects.values_list("id", flat=True)[:2])
    lone = only[0] if len(only) == 1 else None

    out = {}
    for repo in repos:
        found = {ws_of_project[pid] for pid in claims.get(repo, ()) if pid in ws_of_project}
        out[repo] = found.pop() if len(found) == 1 else lone
    return out


def repos_with_open_issues():
    """Every repo that still has an open issue recorded, as a set of names.

    One query, so the run's report can name only the repos where a missed closure
    would actually have cost something — most of the 49 mapped repos have never
    produced an issue, and a warning that lists all of them is a warning nobody
    reads.

    `.order_by()` is load-bearing, not tidying. `GithubIssue` orders by
    `-github_created_at`, and SQL cannot ORDER BY a column that is not in the
    SELECT of a DISTINCT — so Django adds it silently, the DISTINCT key becomes
    (repo, github_created_at), and it stops de-duplicating anything at all. EXPLAIN
    on production showed the sort over every row. Clearing the ordering makes this
    the one-column DISTINCT it was written to be; nothing downstream cares what
    order a set comes back in.

    A named function rather than four lines inline because the trap is invisible
    at the call site and a test cannot reach into a 250-line task body.
    """
    from plane.arribada.models import GithubIssue

    return set(
        GithubIssue.objects.filter(state="open")
        .order_by()
        .values_list("repo", flat=True)
        .distinct()
    )


def _repos_to_sync():
    """owner/repo set: explicit GITHUB_SYNC_REPOS, else every repo mapped to a project."""
    from plane.arribada.models import ProjectWikiDoc
    from plane.arribada.views import _github_url  # reuse the hardened extractor

    # The explicit list ADDS to the mapped ones; it does not replace them.
    #
    # It used to return early, which made sense when it was written: nothing was
    # mapped, so an env var was the only way to name a repo. Now that ten projects
    # declare 43 repos between them, the early return meant the sync fetched nine
    # and ignored the rest — so "issues go to the project that linked the repo"
    # could never fire for a repo that was not also in the variable.
    repos = set()
    explicit = os.environ.get("GITHUB_SYNC_REPOS", "").strip()
    for part in explicit.split(","):
        part = part.strip().removesuffix(".git").strip("/")
        if part:
            repos.add(part.lower())

    for doc in ProjectWikiDoc.objects.exclude(github_repo_urls=[]):
        for url in doc.github_repo_urls or []:
            u = _github_url(url) or str(url)
            # take owner/repo from a github.com url
            m = u.lower().split("github.com/", 1)
            if len(m) == 2:
                parts = m[1].strip("/").split("/")
                if len(parts) >= 2:
                    repos.add(f"{parts[0]}/{parts[1]}".removesuffix(".git"))
    return repos


def _fetch_open_issues(pat, repo, max_pages=5):
    """Open (non-PR) issues for owner/repo, newest-updated first.

    Returns (issues, complete). `complete` means this really is the WHOLE open
    list: every page was fetched successfully and the last one came back short,
    so nothing was cut off by an error or by the page cap.

    That second value is not bookkeeping — closure detection reads absence from
    this list as "no longer open" (see below), and absence is only evidence when
    the list is known to be whole. A timeout returning four issues out of forty
    would otherwise close thirty-six work items.
    """
    out = []
    headers = {"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"}
    for page in range(1, max_pages + 1):
        try:
            r = requests.get(
                f"{GITHUB_API}/repos/{repo}/issues",
                headers=headers,
                params={"state": "open", "sort": "updated", "direction": "desc", "per_page": 100, "page": page},
                timeout=15,
            )
        except Exception:
            return out, False
        if r.status_code != 200:
            return out, False
        items = r.json()
        if not isinstance(items, list):
            return out, False
        # the issues endpoint returns PRs too — drop them. `len(items)` stays the
        # raw page size because that is what paginates.
        out.extend([it for it in items if "pull_request" not in it])
        if len(items) < 100:
            return out, True
    # Ran out of pages with every one of them full: there is more, unread.
    return out, False


def _fetch_issue(pat, repo, number):
    """One issue as GitHub describes it, or None when GitHub would not say.

    None is deliberately NOT "it is gone". A 404 is what a deleted, transferred
    or newly-private issue looks like — and it is also what a revoked token and a
    renamed repository look like. Guessing between them would let one expired PAT
    mark every tracked issue closed on a single run.
    """
    try:
        r = requests.get(
            f"{GITHUB_API}/repos/{repo}/issues/{number}",
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"},
            timeout=15,
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    body = r.json()
    return body if isinstance(body, dict) else None


def _parse_gh_time(value):
    """GitHub's ISO-8601 with a Z, which fromisoformat refuses before 3.11."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _record_github_issue(workspace_id, repo, gh):
    """Keep the issue as GitHub describes it, whole.

    Separate from creating a work item on purpose: an issue nobody has filed yet
    is something GitHub knows about, not work this workspace has accepted. This
    is the record every pre-fill will be read from — a label saying "firmware"
    and an assignee who already has a Plane account were both being discarded
    before anybody could use them.

    Returns the row so the caller can read what triage has already decided about
    it — specifically whether somebody dismissed it. A failure here must never
    take the sync down with it, so the caller gets None and is expected to treat
    that as "no decision on record" rather than as an error.

    `dismissed_at` and `dismissed_by` are deliberately absent from `defaults`:
    everything listed there is GitHub's version of the truth and is meant to be
    overwritten on every run, while a dismissal is this workspace's decision and
    an upsert that carried it away would undo it once a day.
    """
    from plane.arribada.models import GithubIssue

    number = gh.get("number")
    if number is None:
        return None
    try:
        row, _ = GithubIssue.objects.update_or_create(
            workspace_id=workspace_id,
            repo=repo,
            number=int(number),
            defaults={
                "title": (gh.get("title") or "").strip()[:512],
                "body": (gh.get("body") or "")[:20000],
                "html_url": (gh.get("html_url") or "")[:1024],
                "labels": [
                    (label.get("name") or "") if isinstance(label, dict) else str(label)
                    for label in (gh.get("labels") or [])
                ],
                "github_assignees": [
                    {"login": a.get("login") or "", "id": a.get("id")}
                    for a in (gh.get("assignees") or [])
                    if isinstance(a, dict)
                ],
                "milestone": ((gh.get("milestone") or {}).get("title") or "")[:255]
                if isinstance(gh.get("milestone"), dict)
                else "",
                "state": (gh.get("state") or "open")[:32],
                "github_created_at": _parse_gh_time(gh.get("created_at")),
                "github_closed_at": _parse_gh_time(gh.get("closed_at")),
                "github_updated_at": _parse_gh_time(gh.get("updated_at")),
            },
        )
        return row
    except Exception:
        # One malformed issue must not stop the rest of the run.
        return None



def _link_github_issue(workspace_id, repo, gh, issue, auto):
    """Record which work item this GitHub issue ended up in.

    `auto` distinguishes the router's decision from a person's, so an automatic
    one can be found again and undone. Several issues may share one work item —
    filed_issue is a plain FK — so this never assumes a one-to-one.
    """
    from plane.arribada.models import GithubIssue
    from django.utils import timezone as _tz

    number = gh.get("number")
    if number is None:
        return
    try:
        GithubIssue.objects.filter(workspace_id=workspace_id, repo=repo, number=int(number)).update(
            filed_issue=issue, filed_at=_tz.now(), filed_by_rule="auto" if auto else ""
        )
    except Exception:
        pass


def _enrich_filed_issue(issue, project, gh):
    """Fill in what GitHub already knew: discipline, person, sprint, priority, date.

    Every one of these is silent when unsure — see github_enrich. A wrong
    discipline is worse than a missing one, because the missing one shows up on
    the Overview as a gap and the wrong one just quietly costs the wrong rate.
    """
    from plane.db.models import CycleIssue, IssueAssignee, ProjectMember
    from plane.arribada.github_enrich import (
        cycle_from_milestone,
        discipline_from_labels,
        member_from_github_assignees,
        priority_from_labels,
    )
    from plane.arribada.models import IssueRole
    from plane.arribada.views import _project_role_options

    try:
        labels = [
            (label.get("name") or "") if isinstance(label, dict) else str(label)
            for label in (gh.get("labels") or [])
        ]

        discipline = discipline_from_labels(labels, _project_role_options(project.id))
        if discipline:
            IssueRole.objects.update_or_create(issue_id=issue.id, defaults={"role": discipline})

        candidates = list(
            ProjectMember.objects.filter(project=project, is_active=True)
            .exclude(member__email__startswith="bot_user_")
            .values_list("member_id", "member__email", "member__display_name")
        )
        member_id = member_from_github_assignees(gh.get("assignees"), candidates)
        if member_id:
            IssueAssignee.objects.get_or_create(
                issue_id=issue.id, assignee_id=member_id, defaults={"project_id": project.id}
            )

        milestone = gh.get("milestone")
        name = milestone.get("title") if isinstance(milestone, dict) else None
        if name:
            from plane.db.models import Cycle

            cycle_id = cycle_from_milestone(
                name, list(Cycle.objects.filter(project=project).values_list("id", "name"))
            )
            if cycle_id:
                CycleIssue.objects.get_or_create(
                    issue_id=issue.id,
                    cycle_id=cycle_id,
                    defaults={"project_id": project.id, "workspace_id": project.workspace_id},
                )

        priority = priority_from_labels(labels)
        if priority and issue.priority != priority:
            issue.priority = priority
            issue.save(update_fields=["priority"])
    except Exception:
        # Enrichment is a bonus on top of an issue that already arrived. Losing
        # it must never cost the import.
        pass


# --- Closure reconciliation ---------------------------------------------------
#
# WHY IT IS NOT `state=all`, AND WHY IT IS NOT `since=` EITHER.
#
# The obvious fix for "closed issues are never noticed" is to ask GitHub for them:
# `state=all`. Unbounded, and it gets switched off in six months, because it
# re-downloads a repository's entire history every night and the bill grows with
# the repository. It has a second, worse failure: the router files work items from
# whatever the fetch returns, so the FIRST run would import hundreds of long-closed
# issues as fresh tasks into somebody's project.
#
# `since=` is the usual bound, and it needs a watermark that is actually correct.
# The only watermark available here is `GithubIssue.github_updated_at`, and it does
# not carry the weight:
#   - It is not reliably populated. 11 of the 50 rows in production have it NULL,
#     so a max() over a repo's rows is computed from whichever ones happen to have
#     the column filled in.
#   - It records when we last saw an issue OPEN, and the watermark has to be
#     repo-wide. Any issue whose closure falls between its own last-seen time and
#     the repo's high-water mark — which a busier neighbour keeps pushing forward —
#     is invisible to `since` permanently, not just for one run.
# For today's 11 rows `since=` would in fact have worked: all eleven were closed
# hours ago, well after the repo watermark. That is luck, not a property.
#
# So closure is detected from the fetch that already happens. The open list IS the
# complete set of open issues, so a row we record as open that is ABSENT from it is
# no longer open. Detection therefore costs zero extra requests, and cannot import
# history, because only an issue we already track can be reconciled and only an
# open one can be filed. One cheap per-issue GET then CONFIRMS each newly-vanished
# issue and reads its real `closed_at`, at a cost proportional to how many issues
# closed since the last run — not to how many have ever been closed. Once a row is
# `closed` it drops out of the candidate set and is never looked at again, so the
# work per night trends to the number of issues the team actually closes per night.
# `CLOSE_CONFIRM_BUDGET` caps even that.
#
# Absence is only evidence when the list is whole, which is why `_fetch_open_issues`
# reports `complete` and why an incomplete fetch reconciles nothing at all.

# Per-run ceiling on confirmation requests. The candidate set shrinks as rows are
# reconciled, so this only ever bites on a first run or after a long outage — and
# when it does, the rest are simply done on the next run rather than turning one
# night's sync into a rate-limit incident.
CLOSE_CONFIRM_BUDGET = 200

# The two state groups that already mean "nobody is working on this". Cancelled is
# a decision somebody made, not a gap to fill in: an issue closed on GitHub after
# the team cancelled the work here is still cancelled, and overwriting that with
# "completed" would rewrite their answer.
FINAL_GROUPS = ("completed", "cancelled")


def _completed_state_for(project_id, cache):
    """The state THIS project calls done, or None when it has none.

    Per project rather than per repo, and cached, because ten repos claimed by one
    project used to mean ten identical State queries. Lowest `sequence` wins when a
    project has several completed states (Done, Released, Shipped): that is the one
    its board shows first, and picking the last would file work under a stage it
    never reached.
    """
    from plane.db.models import State

    if project_id not in cache:
        cache[project_id] = (
            State.objects.filter(project_id=project_id, group="completed")
            .order_by("sequence")
            .first()
        )
    return cache[project_id]


def _close_filed_item(row, cache):
    """Move the work item this GitHub issue became into its project's done state.

    Returns a one-word reason rather than a boolean, so the run can report what it
    declined to do. Every branch below is a guard, and a guard nobody can see fire
    is indistinguishable from a guard that does not work.

    ON CLOSING WORK SOMEBODY IS HOLDING. This deliberately does NOT check for
    assignees or dates, which the router's `triaged` guard does check. Those two
    guards answer different questions. `triaged` protects WHERE a work item lives:
    a person moved it, so the router must not move it back. This protects nothing
    of the sort — the upstream issue is closed, so the work is done, and leaving it
    open on somebody's board is not respect for their decision, it is a stale row
    they will have to close by hand. The guards that do apply are the ones about a
    decision that CONFLICTS with closing: already final (below), or a shared work
    item whose other GitHub issues are still open.

    It also does not check `filed_by_rule`. The router skips rows a person filed by
    hand because filing is a placement decision and the router must not overrule
    it — but filing by hand is a person stating, more deliberately than the router
    ever does, that this work item IS that GitHub issue. Honouring that statement
    when the issue closes is the same respect, not less of it. Hand-filed closures
    are counted separately in the run's return value so the choice is visible and
    can be argued with; there are zero of them in production today.

    And it never reopens. An issue reopened upstream leaves a Done work item Done,
    because somebody may have marked it done for reasons GitHub knows nothing
    about, and dragging their item back out of Done is a change to their board that
    no automated read of an upstream label can justify. The GitHub row itself does
    return to the queue, which is the right asymmetry: nobody has decided anything
    about an unfiled row, so there is nothing there to overrule.
    """
    from plane.arribada.models import GithubIssue
    from plane.db.models import Issue

    if not row.filed_issue_id:
        return "no_item"

    # `issue_objects`, not `objects`: it also drops archived, draft and triage-state
    # items. A work item somebody archived is not a board this should be writing to.
    issue = (
        Issue.issue_objects.filter(
            id=row.filed_issue_id,
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
        )
        .select_related("state")
        .first()
    )
    if issue is None:
        return "gone"

    if issue.state is not None and issue.state.group in FINAL_GROUPS:
        return "already_final"

    # `filed_issue` is a plain FK, not a one-to-one, and that is the point: three
    # bug reports about one regression are one piece of work. Ticking it off
    # because ONE of them closed would mark finished what the other two say is
    # still open. Dismissed siblings do not get a vote — somebody already said they
    # are nothing.
    if (
        GithubIssue.objects.filter(filed_issue_id=issue.id, dismissed_at__isnull=True)
        .exclude(id=row.id)
        .exclude(state="closed")
        .exists()
    ):
        return "partial_link"

    done = _completed_state_for(issue.project_id, cache)
    if done is None:
        return "no_completed_state"

    issue.state = done
    # `completed_at` is derived from the state group inside Issue.save(), so it has
    # to be named in update_fields or the timestamp is computed and then dropped.
    issue.save(update_fields=["state", "completed_at", "updated_at"])
    return "closed"


def _reconcile_closed(pat, workspace_id, repo, open_numbers, budget, cache):
    """Catch up the rows this workspace still records as open that GitHub does not.

    Only ever called with a COMPLETE open list — see the block above. Returns
    (tally, requests_spent); the caller subtracts the spend from a run-wide budget
    so one repo with a long backlog cannot starve the rest.

    Nothing is deleted here, ever. A closed row is the record that stops the next
    sync resurrecting the issue into the queue, and stops the run after that
    re-filing it as new work.
    """
    from django.db.models import F

    from plane.arribada.models import GithubIssue

    tally = {
        "closed_rows": 0,
        "closed_items": 0,
        "closed_items_manual": 0,
        "unconfirmed": 0,
        "deferred": 0,
        "skipped": {},
    }
    spent = 0

    # Oldest first, so that if the budget runs out the rows that have been wrong
    # longest are the ones that got fixed. `nulls_first` because Postgres sorts
    # NULL last on an ascending order and a row whose timestamp was never recorded
    # is the oldest thing here, not the newest — 11 of the 50 rows in production
    # have no `github_updated_at` at all.
    stale = list(
        GithubIssue.objects.filter(workspace_id=workspace_id, repo=repo, state="open")
        .exclude(number__in=[n for n in open_numbers if n is not None])
        .order_by(F("github_updated_at").asc(nulls_first=True))
    )

    for row in stale:
        if spent >= budget:
            tally["deferred"] += 1
            continue
        gh = _fetch_issue(pat, repo, row.number)
        spent += 1
        if gh is None or (gh.get("state") or "").lower() != "closed":
            # Gone from the open list but GitHub will not confirm it closed:
            # deleted, transferred, made private, or a token that can no longer see
            # it. Left exactly as it is and counted, because a number that keeps
            # climbing is a repo mapping or a PAT somebody has to go and look at —
            # and inventing a closure here would tick off real work.
            tally["unconfirmed"] += 1
            continue

        row.state = "closed"
        # GitHub's own closed_at when it has one. `now()` only as a fallback, so
        # that "when did this close" never reads as blank on a row that plainly did.
        row.github_closed_at = _parse_gh_time(gh.get("closed_at")) or timezone.now()
        row.github_updated_at = _parse_gh_time(gh.get("updated_at")) or row.github_updated_at
        row.save(
            update_fields=["state", "github_closed_at", "github_updated_at", "updated_at"]
        )
        tally["closed_rows"] += 1

        # Saved BEFORE the work item is considered, so that when several rows share
        # one work item the last of them to close sees all its siblings already
        # marked closed and can finish the job.
        reason = _close_filed_item(row, cache)
        if reason == "closed":
            tally["closed_items"] += 1
            if row.filed_by_rule != "auto":
                tally["closed_items_manual"] += 1
        elif reason != "no_item":
            # "no_item" is the ordinary case — a row still waiting in the queue —
            # not a guard declining to act, and counting it would bury the ones
            # that are.
            tally["skipped"][reason] = tally["skipped"].get(reason, 0) + 1

    return tally, spent


# The decorator must sit DIRECTLY on this function. Twice today a helper was
# inserted at this anchor and landed between the two, so @shared_task decorated
# the helper instead — celery never registered the task, beat scheduled a name
# that did not exist, and "Sync now" raised AttributeError. Nothing errored at
# import, `manage.py check` stayed clean, and GitHub ingestion silently stopped.
# Add helpers ABOVE the decorator, never between it and its def.
#
# That rule is why the registered task now lives at the BOTTOM of this file: the sync had to
# be wrapped in a lock, and the alternative was to re-indent 250 lines under a `with`.
def _github_plane_sync():
    """The sync itself. `github_plane_sync` at the end of this file is the registered task
    and wraps this in a Redis lock."""
    from plane.db.models import Issue, IssueAssignee, Project, State, WorkspaceMember

    pat = os.environ.get("GITHUB_PAT")
    if not pat:
        return {"skipped": "GITHUB_PAT not set"}

    repos = _repos_to_sync()
    if not repos:
        return {"skipped": "no repos mapped (set GITHUB_SYNC_REPOS or link repos to projects)"}

    by_repo = {repo: _fetch_open_issues(pat, repo) for repo in repos}
    total_fetched = sum(len(issues) for issues, _ in by_repo.values())

    claims = _repo_claims()
    owners = _repo_owners(claims)
    workspaces = _repo_workspaces(repos, claims)

    captured = created = updated = filed = queued = dismissed_skipped = 0
    closed_rows = closed_items = closed_items_manual = 0
    unconfirmed = deferred = 0
    close_skipped = {}
    no_workspace = []
    partial_fetch = []
    confirm_budget = CLOSE_CONFIRM_BUDGET

    # Per-project, not per-repo: ten repos claimed by one project used to mean ten
    # identical State queries.
    state_of = {}
    author_of = {}
    done_state_of = {}

    # Repos where an unreadable open list would actually cost something. Most of
    # the 49 mapped repos have never produced an issue, and naming all of them
    # when the token expires produces a warning nobody can read — which is the
    # same as no warning. One query, so the report can name only the repos where
    # a closure could have been missed.
    tracked_open = repos_with_open_issues()

    for repo, (issues, complete) in by_repo.items():
        workspace_id = workspaces.get(repo)

        # Reconciliation runs BEFORE the "nothing to import" shortcut and is not
        # gated on there being any open issues, because a repo whose every open
        # issue has just been closed returns an empty list — and that is the repo
        # with the most to reconcile, not the least.
        if workspace_id is not None and complete:
            tally, spent = _reconcile_closed(
                pat,
                workspace_id,
                repo,
                {gh.get("number") for gh in issues},
                confirm_budget,
                done_state_of,
            )
            confirm_budget -= spent
            closed_rows += tally["closed_rows"]
            closed_items += tally["closed_items"]
            closed_items_manual += tally["closed_items_manual"]
            unconfirmed += tally["unconfirmed"]
            deferred += tally["deferred"]
            for reason, n in tally["skipped"].items():
                close_skipped[reason] = close_skipped.get(reason, 0) + n
        elif workspace_id is not None and repo in tracked_open:
            # The fetch errored or hit the page cap, so absence proves nothing and
            # this repo is left entirely alone this run. Named rather than counted:
            # a repo that is permanently over the cap needs a person, and it will
            # never fix itself.
            partial_fetch.append(repo)

        if not issues:
            continue

        if workspace_id is None:
            # Named in GITHUB_SYNC_REPOS or in a wiki doc, but nothing says whose
            # it is. Reported rather than dropped: it is a mapping to fix.
            no_workspace.append(repo)
            continue

        # Where this repo's issues go. None means the triage queue, which is the
        # normal answer for an unclaimed or contested repo, not a failure.
        target = None
        owner_id = owners.get(repo)
        if owner_id:
            target = (
                Project.objects.filter(
                    id=owner_id, archived_at__isnull=True, workspace_id=workspace_id
                )
                .select_related("workspace")
                .first()
            )

        target_state = None
        author_id = None
        if target is not None:
            if target.id not in state_of:
                state_of[target.id] = (
                    State.objects.filter(project=target, default=True).first()
                    or State.objects.filter(project=target).order_by("sequence").first()
                )
                author_of[target.id] = target.created_by_id or (
                    WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True)
                    .values_list("member_id", flat=True)
                    .first()
                )
            target_state = state_of[target.id]
            author_id = author_of[target.id]

        for gh in issues:
            # Unconditional, and first. This is the capture the triage page reads,
            # and it is the reason the sync no longer needs a project to exist:
            # what GitHub said is worth keeping whether or not anybody has decided
            # where it belongs.
            record = _record_github_issue(workspace_id, repo, gh)
            if record is not None:
                captured += 1

            # Somebody looked at this and decided it belongs nowhere. Making a
            # work item for it now is exactly the thing dismissing was meant to
            # prevent — the row would be back in the queue tomorrow and the
            # decision would have cost nothing. The record itself stays current
            # (title, labels, state), so restoring it later shows today's issue
            # rather than the one from the day it was set aside.
            if record is not None and record.dismissed_at is not None:
                dismissed_skipped += 1
                continue

            if target is None:
                # Nobody claims this repo, or several do. Creating anything here
                # is the guess the triage queue exists to avoid — a work item in a
                # project that never asked for it costs somebody a deletion, and a
                # holding project to put it in instead is the inbox we just
                # retired for filling up unread.
                queued += 1
                continue

            # A person already filed this somewhere. Filing IS triage — the same
            # decision the `triaged` check below protects, made one step earlier —
            # so the router must not now drag the work item to the project it
            # would have picked. Rows it filed itself ("auto") stay its own to
            # keep up to date.
            if record is not None and record.filed_issue_id and record.filed_by_rule != "auto":
                continue

            gid = str(gh.get("id") or "")
            if not gid:
                continue
            url = gh.get("html_url") or f"https://github.com/{repo}"
            title = (gh.get("title") or "").strip()[:250] or f"{repo}#{gh.get('number')}"
            # the description carries the repo url so classification can map it
            desc_html = f'<p><a href="{url}">{url}</a></p>'

            # Workspace-wide, not just the target project: the same issue may
            # already have been filed by hand into a different project, and
            # creating a second copy is how one issue becomes two tasks.
            #
            # Deleted and archived projects are excluded deliberately. The
            # retired GHIN inbox still holds its rows, soft-deleted along with
            # it; adopting one would resurrect a work item into a live project
            # by a side door, which is not what retiring the inbox meant.
            existing = Issue.objects.filter(
                external_source="github",
                external_id=gid,
                workspace_id=workspace_id,
                project__deleted_at__isnull=True,
                project__archived_at__isnull=True,
            ).first()
            if existing:
                # A row somebody has already dealt with is theirs, not the
                # sync's. Filing it, dating it, attaching it to a task or
                # assigning it are all acts of triage, and re-importing over
                # any of them undoes a decision a human made deliberately —
                # which is worse than the issue never arriving.
                #
                # Read from the work itself rather than a "touched" flag:
                # a flag has to be set by every code path that edits an
                # issue, and the one path that forgets is the one that
                # silently loses somebody's afternoon.
                triaged = bool(
                    existing.start_date
                    or existing.target_date
                    or existing.parent_id
                    # The explicit join, not `existing.assignees`: the M2M
                    # goes through IssueAssignee, which is soft-deleted, so a
                    # removed assignee would still count as triage.
                    or IssueAssignee.objects.filter(
                        issue_id=existing.id, deleted_at__isnull=True
                    ).exists()
                )
                if triaged:
                    continue

                fields = []
                if existing.project_id != target.id:
                    existing.project_id = target.id
                    existing.state = target_state
                    fields.extend(["project", "state"])
                if existing.name != title:
                    existing.name = title
                    fields.append("name")
                if url not in (existing.description_html or ""):
                    existing.description_html = desc_html
                    fields.append("description_html")
                if fields:
                    existing.save(update_fields=fields)
                    updated += 1
                # Even when nothing needed changing: the record of WHERE this
                # issue lives was missing, and an unlinked row is one the queue
                # would offer again.
                if record is not None and not record.filed_issue_id:
                    _link_github_issue(workspace_id, repo, gh, existing, True)
                    filed += 1
            else:
                made = Issue.objects.create(
                    workspace=target.workspace,
                    project=target,
                    name=title,
                    description_html=desc_html,
                    external_source="github",
                    external_id=gid,
                    state=target_state,
                    created_by_id=author_id,
                )
                created += 1
                # Only on creation. Enriching an existing row would overwrite
                # decisions somebody made.
                _enrich_filed_issue(made, target, gh)
                _link_github_issue(workspace_id, repo, gh, made, True)
                filed += 1

    # Every one of these is a different thing that happened, and collapsing them
    # was how "the sync ran and created nothing" read as success. `skipped` stays
    # reserved for the two early configuration answers above — the Sync-now view
    # treats a truthy `skipped` as "nothing to do", so the repos that could not be
    # placed get their own key.
    return {
        "repos": len(repos),
        "fetched": total_fetched,
        "captured": captured,
        "created": created,
        "updated": updated,
        "filed": filed,
        "queued": queued,
        "dismissed_skipped": dismissed_skipped,
        # Closed on GitHub since the last run: rows taken out of the triage queue,
        # and the work items moved to done because of them. Reported apart from
        # `updated` on purpose — that one counts work items the router rewrote, and
        # a state change nobody asked for is the thing most worth being able to see.
        "closed_rows": closed_rows,
        "closed_items": closed_items,
        # Of those, items a PERSON had filed by hand rather than the router. The
        # judgement call in _close_filed_item, made visible rather than argued for
        # in a comment nobody reads.
        "closed_items_manual": closed_items_manual,
        # Guards that declined to close something: already_final, partial_link,
        # no_completed_state, gone. Empty is the normal answer.
        "close_skipped": close_skipped,
        # Rows that vanished from a repo's open list but that GitHub would not
        # confirm closed, and rows left for the next run by the confirmation
        # budget. Both are "we do not know yet", not "nothing happened".
        "close_unconfirmed": unconfirmed,
        "close_deferred": deferred,
        "skipped_no_workspace": sorted(no_workspace),
        # Repos whose open list came back short or errored: nothing was reconciled
        # there, because absence from a partial list is not evidence of closure.
        "skipped_partial_fetch": sorted(partial_fetch),
        "at": str(timezone.now()),
    }


# The decorator must sit DIRECTLY on this function. Twice a helper was inserted at this
# anchor and landed between the two, so @shared_task decorated the helper instead — celery
# never registered the task, beat scheduled a name that did not exist, and "Sync now" raised
# AttributeError. Nothing errored at import and `manage.py check` stayed clean.
# Add helpers ABOVE this comment, never between it and the def.
@shared_task(**BASE, **HTTP_RETRY_POLICY)
def github_plane_sync(self):
    """One sync at a time, forkwide.

    The body is check-then-act from end to end — "is there already a work item for this
    GitHub id?" then `Issue.objects.create` — and there is no unique constraint underneath
    it. Two concurrent runs both read "no" and both create, so one GitHub issue becomes two
    work items in the project, which someone then has to notice and unpick.

    Concurrency was not hypothetical: with nothing expiring the messages, a broker outage
    ended with every missed 30-minute tick delivered at once into four prefork children.
    """
    with task_lock("github_plane_sync", SYNC_LOCK_SECONDS) as held:
        if not held:
            # `skipped` is the key the "Sync now" view reads as "nothing to do", which is the
            # honest answer: a sync IS running, and starting a second one is the bug.
            return {"skipped": "another github_plane_sync run is already in progress"}
        return _github_plane_sync()
