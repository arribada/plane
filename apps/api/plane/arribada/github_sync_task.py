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

GITHUB_API = "https://api.github.com"


def _repo_claims():
    """owner/repo -> {project_id, ...}: every project that named the repo.

    Kept whole, contested repos included, because two callers need two different
    answers from the same scan: the router wants the repos exactly one project
    claims, and the triage queue wants to show a person WHICH projects are
    arguing over the rest so they can settle it.
    """
    from plane.arribada.models import ProjectWikiDoc
    from plane.arribada.views import _github_url

    claims = {}
    for doc in ProjectWikiDoc.objects.exclude(github_repo_urls=[]).values_list("project_id", "github_repo_urls"):
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
    """Open (non-PR) issues for owner/repo, newest-updated first."""
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
            break
        if r.status_code != 200:
            break
        items = r.json()
        if not isinstance(items, list) or not items:
            break
        # the issues endpoint returns PRs too — drop them
        out.extend([it for it in items if "pull_request" not in it])
        if len(items) < 100:
            break
    return out


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


# The decorator must sit DIRECTLY on this function. Twice today a helper was
# inserted at this anchor and landed between the two, so @shared_task decorated
# the helper instead — celery never registered the task, beat scheduled a name
# that did not exist, and "Sync now" raised AttributeError. Nothing errored at
# import, `manage.py check` stayed clean, and GitHub ingestion silently stopped.
# Add helpers ABOVE the decorator, never between it and its def.
@shared_task
def github_plane_sync():
    from plane.db.models import Issue, IssueAssignee, Project, State, WorkspaceMember

    pat = os.environ.get("GITHUB_PAT")
    if not pat:
        return {"skipped": "GITHUB_PAT not set"}

    repos = _repos_to_sync()
    if not repos:
        return {"skipped": "no repos mapped (set GITHUB_SYNC_REPOS or link repos to projects)"}

    by_repo = {repo: _fetch_open_issues(pat, repo) for repo in repos}
    total_fetched = sum(len(v) for v in by_repo.values())

    claims = _repo_claims()
    owners = _repo_owners(claims)
    workspaces = _repo_workspaces(repos, claims)

    captured = created = updated = filed = queued = dismissed_skipped = 0
    no_workspace = []

    # Per-project, not per-repo: ten repos claimed by one project used to mean ten
    # identical State queries.
    state_of = {}
    author_of = {}

    for repo, issues in by_repo.items():
        if not issues:
            continue

        workspace_id = workspaces.get(repo)
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
        "skipped_no_workspace": sorted(no_workspace),
        "at": str(timezone.now()),
    }
