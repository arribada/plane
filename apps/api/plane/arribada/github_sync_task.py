# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Periodic GitHub -> Plane ingestion. Pulls OPEN issues from the GitHub repos the
# team has mapped to projects (ProjectWikiDoc.github_repo_urls), or an explicit
# GITHUB_SYNC_REPOS allowlist, and UPSERTs them into the GHIN inbox project keyed
# on external_id — so re-runs update instead of duplicating. The existing
# github_classification task then routes each into its real project.
#
# Dormant unless GITHUB_PAT is set (then it also lights up the classification task
# and the Team-Hub activity feed, which read the same token). Scoped to mapped
# repos on purpose, so a first run can't flood GHIN with every open org issue.

import os
from datetime import datetime
from datetime import timedelta

import requests
from celery import shared_task
from django.utils import timezone

GITHUB_API = "https://api.github.com"


def _repo_owners():
    """owner/repo -> the project that linked it. Empty when nobody has linked one.

    The inbox was the only destination because nothing here knew where an issue
    belonged. Now that a project names its repos, most issues have an obvious home
    and routing them there is the difference between a queue somebody triages and
    a queue somebody ignores.

    A repo linked by TWO projects stays unrouted on purpose: guessing which one
    owns it would file work under a project that never asked for it, and the
    inbox is exactly the right place for "a human has to decide".
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

    return {repo: next(iter(owners)) for repo, owners in claims.items() if len(owners) == 1}


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


def _record_github_issue(workspace, repo, gh):
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
            workspace=workspace,
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



def _link_github_issue(workspace, repo, gh, issue, auto):
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
        GithubIssue.objects.filter(workspace=workspace, repo=repo, number=int(number)).update(
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

    # fetch once; the same issues feed every GHIN project (usually just one)
    by_repo = {repo: _fetch_open_issues(pat, repo) for repo in repos}
    total_fetched = sum(len(v) for v in by_repo.values())

    created = updated = 0
    owners = _repo_owners()

    for ghin in Project.objects.filter(identifier="GHIN").select_related("workspace"):
        author_id = ghin.created_by_id or (
            WorkspaceMember.objects.filter(workspace=ghin.workspace, is_active=True)
            .values_list("member_id", flat=True)
            .first()
        )
        default_state = (
            State.objects.filter(project=ghin, default=True).first()
            or State.objects.filter(project=ghin).order_by("sequence").first()
        )

        for repo, issues in by_repo.items():
            # Where this repo's issues belong. The inbox is the fallback, not the
            # default: an issue from a repo nobody claimed, or one two projects
            # claim, is precisely what an inbox is for.
            target = ghin
            owner_id = owners.get(repo)
            if owner_id:
                claimed = Project.objects.filter(id=owner_id, archived_at__isnull=True).select_related("workspace").first()
                # Same workspace only. A repo linked from another workspace's
                # project would otherwise write an issue across a boundary that
                # every permission check in Plane assumes cannot be crossed.
                if claimed and claimed.workspace_id == ghin.workspace_id:
                    target = claimed

            target_state = (
                default_state
                if target.id == ghin.id
                else (
                    State.objects.filter(project=target, default=True).first()
                    or State.objects.filter(project=target).order_by("sequence").first()
                )
            )

            for gh in issues:
                # Recorded whether or not it becomes a work item here: the raw
                # issue is what the triage view will be built on.
                record = _record_github_issue(ghin.workspace, repo, gh)
                # Somebody looked at this and decided it belongs nowhere. Making a
                # work item for it now is exactly the thing dismissing was meant to
                # prevent — the row would be back in the inbox tomorrow and the
                # decision would have cost nothing. The record itself stays current
                # (title, labels, state), so restoring it later shows today's issue
                # rather than the one from the day it was set aside.
                if record is not None and record.dismissed_at is not None:
                    continue
                gid = str(gh.get("id") or "")
                if not gid:
                    continue
                url = gh.get("html_url") or f"https://github.com/{repo}"
                title = (gh.get("title") or "").strip()[:250] or f"{repo}#{gh.get('number')}"
                # the description carries the repo url so classification can map it
                desc_html = f'<p><a href="{url}">{url}</a></p>'

                # Across both projects, not just the target: the row may already
                # sit in the inbox from before this repo was linked, and creating a
                # second copy in the project is how one issue becomes two tasks.
                existing = (
                    Issue.objects.filter(external_source="github", external_id=gid)
                    .filter(project__in=[p for p in {ghin.id, target.id}])
                    .first()
                )
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
                    # Only on creation, and only when a real project claimed the
                    # repo. Enriching an inbox row would put a discipline and an
                    # assignee on work nobody has accepted yet, and enriching an
                    # existing row would overwrite decisions somebody made.
                    if target.id != ghin.id:
                        _enrich_filed_issue(made, target, gh)
                    _link_github_issue(ghin.workspace, repo, gh, made, target.id != ghin.id)

    return {"repos": len(repos), "fetched": total_fetched, "created": created, "updated": updated, "at": str(timezone.now())}
