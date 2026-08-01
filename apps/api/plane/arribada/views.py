# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import html
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Min, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, User, WorkspaceMember
from plane.db.models import IssueRelation

from plane.db.models import Workspace

from .models import (
    PROJECT_ROLES,
    canonical_role,
    IssueBaseline,
    IssueRole,
    ProjectFolder,
    ProjectFolderItem,
    ProjectSchedule,
    ProjectStatusUpdate,
    ProjectTeamMember,
    ProcurementRequest,
    ProjectExpense,
    ProjectWikiDoc,
    WorkspaceAiSettings,
    WorkspaceNonWorkingDay,
    WorkspaceRoleRate,
)
from .scheduling import build_edges, cascade, critical_path, slack_for_issues
from .serializers import ProjectScheduleSerializer

VIEWER_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]

# Only sequencing relations get drawn as gantt arrows; relates_to/duplicate are noise.
GANTT_RELATION_TYPES = ["finish_before", "start_before", "blocked_by", "finish_after", "start_after"]


def _project_graph(project_id, slug):
    """(issues-by-id dict of dates, list of relation dicts) for a project."""
    issues = {
        str(i["id"]): {"start": i["start_date"], "target": i["target_date"]}
        for i in Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug).values(
            "id", "start_date", "target_date"
        )
    }
    relations = list(
        IssueRelation.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            relation_type__in=GANTT_RELATION_TYPES,
            deleted_at__isnull=True,
        ).values("issue_id", "related_issue_id", "relation_type")
    )
    for r in relations:
        r["issue_id"] = str(r["issue_id"])
        r["related_issue_id"] = str(r["related_issue_id"])
    return issues, relations


def _visible_projects(request, slug):
    """Projects of the workspace the requesting user is an active member of."""
    return Project.objects.filter(
        workspace__slug=slug,
        project_projectmember__member=request.user,
        project_projectmember__is_active=True,
    )


_GH_URL_RE = re.compile(r"https?://github\.com/[^\s\"'<>)]+", re.IGNORECASE)


def _github_url(text):
    """First github.com URL found in a blob of html/text, or None.

    The source is HTML, so decode entities (&amp; -> &) and cut at any quote/bracket
    that decoding reveals, otherwise a query-string URL leaks an `&amp;` into the link.
    """
    if not text:
        return None
    m = _GH_URL_RE.search(str(text))
    if not m:
        return None
    url = re.split(r"[\"'<>\s]", html.unescape(m.group(0)))[0]
    return url.rstrip(".,;") or None


def _uuid_list(values):
    """Only the well-formed UUIDs in `values`, as strings.

    A malformed id in a request body must never reach a UUIDField lookup: Django
    raises there rather than simply not matching, which turns a client typo into a 500.
    """
    out = []
    for value in values or []:
        try:
            out.append(str(uuid.UUID(str(value))))
        except (AttributeError, TypeError, ValueError):
            continue
    return out


def _assignable_member_ids(project_id, member_ids=None):
    """Users Plane will accept as assignees on this project.

    Mirrors the check IssueSerializer.validate does (role >= MEMBER and is_active):
    a guest or a deactivated member cannot own a work item, so proposing them would
    produce a plan that silently fails to apply.
    """
    qs = ProjectMember.objects.filter(
        project_id=project_id, is_active=True, role__gte=ROLE.MEMBER.value
    )
    if member_ids is not None:
        qs = qs.filter(member_id__in=list(member_ids))
    return {str(m) for m in qs.values_list("member_id", flat=True)}


def _clean_roles(values):
    """A person's disciplines: trimmed, de-duplicated, bounded, order preserved.

    No membership test against PROJECT_ROLES — free text is accepted on purpose (see
    the constant); this only stops a client writing a novel into a JSON column.
    """
    out = []
    seen = set()
    for value in values or []:
        # Folds retired names onto the surviving one, so anything still writing
        # "project lead" (the wiki leader sync did) lands as "project manager"
        # instead of creating a second discipline nobody's tasks ask for.
        role = canonical_role(value)[:80]
        if not role or role.lower() in seen:
            continue
        seen.add(role.lower())
        out.append(role)
        if len(out) >= 12:
            break
    return out


def _team_rows(project_id):
    """The project roster in the shape the UI and the Overview both consume.

    `in_plane` and `assignable` are two different facts and the UI needs both to
    explain itself: someone can be on the roster with no Plane account at all, or have
    an account but not be a member of *this* project — in either case the assistant
    cannot hand them a work item, and the user deserves to be told which it is.
    """
    rows = list(ProjectTeamMember.objects.filter(project_id=project_id))
    linked = [str(r.member_id) for r in rows if r.member_id]
    assignable = _assignable_member_ids(project_id, linked) if linked else set()
    return [
        {
            "id": str(r.id),
            "member_id": str(r.member_id) if r.member_id else None,
            "name": r.name,
            "email": r.email or "",
            "roles": list(r.roles or []),
            "is_lead": bool(r.is_lead),
            "source": r.source,
            "in_plane": bool(r.member_id),
            "assignable": str(r.member_id) in assignable if r.member_id else False,
        }
        for r in rows
    ]


def _role_holders(project_id):
    """{lowercased discipline: user_id} — who a work item needing that discipline goes to.

    Only a roster entry Plane will actually accept as an assignee can hold a discipline
    here (linked account, active project member, role >= MEMBER). Everyone else holds it
    on paper, which is the normal state of this instance and not a failure: the
    requirement stays recorded on the item and materialises the day they get an account.

    Where two people share a discipline the lead wins, then the first by name. A stable
    tie-break, not an arbitrary one — otherwise every reconcile pass could hand the same
    work to a different engineer and the feed would fill with phantom re-assignments.
    """
    rows = list(ProjectTeamMember.objects.filter(project_id=project_id))
    linked = [str(r.member_id) for r in rows if r.member_id]
    assignable = _assignable_member_ids(project_id, linked) if linked else set()
    holders = {}
    for row in sorted(rows, key=lambda r: (not r.is_lead, (r.name or "").lower())):
        if not row.member_id or str(row.member_id) not in assignable:
            continue
        for role in row.roles or []:
            holders.setdefault(str(role).strip().lower(), str(row.member_id))
    return holders


def _role_vocabulary(project_id):
    """The disciplines the planning assistant may name on this project.

    The project's own roster comes first, because that is where the real vocabulary
    lives — a project with an acoustics person needs the model to be able to answer
    "acoustics". The standard list is appended as the floor, so a project whose roster
    is still empty does not leave the model with nothing to say.
    """
    out, seen = [], set()
    for roles in ProjectTeamMember.objects.filter(project_id=project_id).values_list("roles", flat=True):
        for role in _clean_roles(roles):
            if role.lower() not in seen:
                seen.add(role.lower())
                out.append(role)
    for value, _label in PROJECT_ROLES:
        if value.lower() not in seen:
            seen.add(value.lower())
            out.append(value)
    return out


def _materialise_issue_roles(project, actor_id, issue_ids=None, origin=None):
    """Point every work item carrying a discipline at whoever currently holds it.

    Called after anything that can change the answer — a roster edit, a wiki sync, a
    plan being applied — because the roles are the durable fact and the assignments are
    derived from them. ADD only: a person a human put on an item by hand is never taken
    off, the same rule apply-plan follows.

    Bounded and idempotent by construction: the roster, the roles and the current
    assignee rows are read in a fixed number of queries whatever the size of the
    project, and the write is one bulk_create whose ignore_conflicts absorbs both a
    re-run and the race with someone assigning by hand in the UI. Returns the ids of
    the issues that gained an owner.
    """
    from plane.bgtasks.issue_activities_task import issue_activity

    holders = _role_holders(project.id)
    if not holders:
        return set()

    role_rows = IssueRole.objects.filter(
        issue__project_id=project.id, issue__deleted_at__isnull=True
    )
    if issue_ids is not None:
        role_rows = role_rows.filter(issue_id__in=list(issue_ids))
    wanted = defaultdict(set)
    for issue_id, role in role_rows.values_list("issue_id", "role"):
        holder = holders.get(str(role).strip().lower())
        if holder:
            wanted[str(issue_id)].add(holder)
    if not wanted:
        return set()

    # Read through IssueAssignee and never the `assignees` m2m: assignee rows are
    # soft-deleted and a m2m join does not apply the through model's manager, so a
    # removed owner would still look present and the item would never be re-pointed.
    current = defaultdict(set)
    for a in IssueAssignee.objects.filter(
        issue_id__in=list(wanted.keys()), deleted_at__isnull=True
    ).values("issue_id", "assignee_id"):
        current[str(a["issue_id"])].add(str(a["assignee_id"]))

    new_links, gained = [], {}
    for issue_id, owners in wanted.items():
        to_add = owners - current[issue_id]
        if not to_add:
            continue
        gained[issue_id] = to_add
        for assignee_id in sorted(to_add):
            # bulk_create bypasses save(), so the denormalised project/workspace columns
            # have to be set here or the rows land with NULLs — same construction as
            # IssueSerializer.create upstream.
            new_links.append(
                IssueAssignee(
                    issue_id=issue_id,
                    assignee_id=assignee_id,
                    project_id=project.id,
                    workspace_id=project.workspace_id,
                    created_by_id=actor_id,
                )
            )
    if not new_links:
        return set()
    IssueAssignee.objects.bulk_create(new_links, batch_size=100, ignore_conflicts=True)

    # Writing the rows notifies nobody on its own; track_assignees inside this task is
    # what creates the activity, subscribes the new owner and sends the mail — an
    # assignment nobody is told about is not an assignment. Skipped entirely when there
    # is no actor to attribute it to: the notification fan-out dereferences actor_id, and
    # a silent hand-over beats a crashed roster sync.
    if actor_id:
        for issue_id, added in gained.items():
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"assignee_ids": sorted(current[issue_id] | added)}),
                actor_id=str(actor_id),
                issue_id=str(issue_id),
                project_id=str(project.id),
                current_instance=json.dumps({"assignee_ids": sorted(current[issue_id])}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=origin,
            )
    return set(gained.keys())


def _plan_candidates(project_id, load_projects):
    """The people the planning assistant may propose as owners, with the disciplines
    and the current load it needs in order to choose between them.

    Refs are opaque (P1, P2) for the same reason the work items get T-refs: a UUID in
    a prompt is tokens wasted and an invitation to hallucinate a plausible one back.

    Ordered by name rather than by load, so the ref a person gets does not move between
    two runs and P1 is not systematically the idlest (and so the likeliest to be picked).
    """
    member_ids = _assignable_member_ids(project_id)
    if not member_ids:
        return []
    roles_of = {}
    for row in ProjectTeamMember.objects.filter(project_id=project_id, member_id__in=list(member_ids)):
        if row.roles and str(row.member_id) not in roles_of:
            roles_of[str(row.member_id)] = _clean_roles(row.roles)
    load = _load_by_assignee(load_projects)
    people = []
    for user in User.objects.filter(id__in=list(member_ids)):
        stats = load.get(str(user.id), {})
        people.append(
            {
                "user_id": str(user.id),
                "name": user.display_name or user.first_name or user.email,
                "roles": roles_of.get(str(user.id), []),
                "assigned": stats.get("assigned", 0),
                "overdue": stats.get("overdue", 0),
            }
        )
    people.sort(key=lambda c: (c["name"] or "").lower())
    for index, person in enumerate(people):
        person["ref"] = f"P{index + 1}"
    return people


def _users_by_email(slug, emails):
    """{lowercased address: User} for active members of the workspace.

    The roster links a person to a Plane account through their address and nothing
    else. Matching on a display name would be a guess, and "Tom" is two different
    people here — a wrong link would hand someone else's work to the wrong person.
    """
    wanted = {str(e).strip().lower() for e in emails if e and str(e).strip()}
    if not wanted:
        return {}
    lookup = Q()
    for address in wanted:
        lookup |= Q(email__iexact=address)
    users = User.objects.filter(lookup).filter(
        id__in=WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values("member_id")
    )
    return {u.email.lower(): u for u in users if u.email}


def _load_by_assignee(projects):
    """Open assigned work per user across `projects`: how much, how much overdue,
    how much due this week, and the estimate points behind it.

    Shared by the workload view and by the planning assistant, which needs the same
    numbers to spread work instead of piling it on whoever is already drowning.
    Counted through IssueAssignee and never through the `assignees` m2m: assignee rows
    are soft-deleted, and a m2m join does not apply the through model's manager, so an
    issue whose only assignee was removed would still count against them.
    """
    today = timezone.now().date()
    week = today + timedelta(days=7)
    active = IssueAssignee.objects.filter(
        issue__project__in=projects, issue__deleted_at__isnull=True, deleted_at__isnull=True
    ).exclude(issue__state__group__in=["completed", "cancelled"])
    return {
        str(r["assignee_id"]): r
        for r in active.values("assignee_id").annotate(
            assigned=Count("issue_id", distinct=True),
            overdue=Count("issue_id", filter=Q(issue__target_date__lt=today), distinct=True),
            due_week=Count(
                "issue_id",
                filter=Q(issue__target_date__gte=today, issue__target_date__lte=week),
                distinct=True,
            ),
            points=Sum("issue__point"),
        )
    }


class PortfolioEndpoint(BaseAPIView):
    """One row per project: the planned range, the range derived from its work
    items, and how many items cannot be placed on a timeline at all.

    The undated count is deliberately surfaced rather than hidden: a rolled-up bar
    built from 5 dated items out of 23 is a lie, and the caller must be able to say so.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        include_archived = request.GET.get("include_archived", "false") == "true"

        projects = _visible_projects(request, slug)
        if not include_archived:
            projects = projects.filter(archived_at__isnull=True)
        projects = projects.values("id", "name", "identifier", "logo_props", "archived_at")

        project_ids = [p["id"] for p in projects]

        schedules = {
            s.project_id: s
            for s in ProjectSchedule.objects.filter(project_id__in=project_ids)
        }

        # Baseline roll-up: the latest committed target across a project's issues, so
        # the UI can show drift (current derived target vs the frozen baseline).
        baselines = {
            b["issue__project_id"]: b["bmax"]
            for b in IssueBaseline.objects.filter(issue__project_id__in=project_ids)
            .values("issue__project_id")
            .annotate(bmax=Max("target_date"))
        }

        dated = Q(start_date__isnull=False) | Q(target_date__isnull=False)
        rollup = {
            r["project_id"]: r
            for r in Issue.issue_objects.filter(
                project_id__in=project_ids, workspace__slug=slug
            )
            .values("project_id")
            .annotate(
                derived_start_date=Min("start_date"),
                derived_target_date=Max("target_date"),
                item_count=Count("id"),
                dated_count=Count("id", filter=dated),
                completed_count=Count("id", filter=Q(state__group="completed")),
            )
        }

        payload = []
        for p in projects:
            s = schedules.get(p["id"])
            r = rollup.get(p["id"], {})
            total = r.get("item_count", 0)
            with_dates = r.get("dated_count", 0)
            payload.append(
                {
                    "id": str(p["id"]),
                    "name": p["name"],
                    "identifier": p["identifier"],
                    "logo_props": p["logo_props"],
                    "archived": bool(p["archived_at"]),
                    # planned: entered by a human, draggable in the UI
                    "start_date": s.start_date if s else None,
                    "target_date": s.target_date if s else None,
                    # derived: computed from the work items, read-only
                    "derived_start_date": r.get("derived_start_date"),
                    "derived_target_date": r.get("derived_target_date"),
                    "item_count": total,
                    "scheduled_item_count": with_dates,
                    "undated_item_count": total - with_dates,
                    "completed_item_count": r.get("completed_count", 0),
                    "baseline_target_date": baselines.get(p["id"]),
                }
            )
        return Response(payload, status=status.HTTP_200_OK)


class PortfolioItemsEndpoint(BaseAPIView):
    """Work items of one project, for expanding a portfolio row.

    Loaded per project on demand: expanding every project at once is what makes
    these views collapse, so the client never has to fetch what it does not show.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response(
                {"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND
            )

        only_undated = request.GET.get("undated", "false") == "true"
        items = Issue.issue_objects.filter(
            project_id=project_id, workspace__slug=slug
        )
        if only_undated:
            items = items.filter(start_date__isnull=True, target_date__isnull=True)

        item_list = list(
            items.order_by("start_date", "sequence_id").values(
                "id",
                "name",
                "sequence_id",
                "start_date",
                "target_date",
                "state_id",
                "parent_id",
                "priority",
            )[:500]
        )

        # Attach assignees (id + name + avatar) so the timeline can show who owns each bar.
        # select_related the avatar_asset too: avatar_url reads it, else it's an N+1 per assignee.
        assignees = defaultdict(list)
        for a in IssueAssignee.objects.filter(
            issue_id__in=[i["id"] for i in item_list]
        ).select_related("assignee", "assignee__avatar_asset"):
            u = a.assignee
            assignees[a.issue_id].append(
                {
                    "id": str(u.id),
                    "name": u.display_name or u.first_name or u.email,
                    "avatar": getattr(u, "avatar_url", None) or None,
                }
            )
        for i in item_list:
            i["assignees"] = assignees.get(i["id"], [])

        return Response(item_list, status=status.HTTP_200_OK)


class ProjectRelationsEndpoint(BaseAPIView):
    """Every sequencing dependency between a project's issues, in one call.

    Plane's per-issue relation endpoint would be one request per bar; the gantt
    needs them all at once to draw arrows, so this returns the whole project set.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        edges = IssueRelation.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            relation_type__in=GANTT_RELATION_TYPES,
            deleted_at__isnull=True,
        ).values("issue_id", "related_issue_id", "relation_type")
        return Response(list(edges), status=status.HTTP_200_OK)


class ProjectProgressEndpoint(BaseAPIView):
    """Per-issue completion % for a project, for filling gantt bars.

    A parent's % is the share of its sub-issues in a completed state; a leaf's %
    is 100 if its own state is completed, else 0. Computed in two grouped queries,
    not per issue.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        base = Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug)
        # child rollup: completed children / total children, per parent
        child_stats = {
            row["parent_id"]: row
            for row in base.filter(parent__isnull=False)
            .values("parent_id")
            .annotate(
                total=Count("id"),
                done=Count("id", filter=Q(state__group="completed")),
            )
        }
        payload = []
        for issue in base.values("id", "state__group"):
            iid = issue["id"]
            stats = child_stats.get(iid)
            if stats and stats["total"]:
                percent = round(100 * stats["done"] / stats["total"])
            else:
                percent = 100 if issue["state__group"] == "completed" else 0
            payload.append({"issue_id": str(iid), "percent": percent})
        return Response(payload, status=status.HTTP_200_OK)


class ProjectBaselineEndpoint(BaseAPIView):
    """Capture (POST) or read (GET) the date baseline of a project's issues.

    POST freezes every issue's current start/target into IssueBaseline (upsert);
    GET returns them so the gantt can draw ghost bars behind the live ones.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        rows = IssueBaseline.objects.filter(
            issue__project_id=project_id, issue__workspace__slug=slug
        ).values("issue_id", "start_date", "target_date")
        data = [
            {"issue_id": str(r["issue_id"]), "start_date": r["start_date"], "target_date": r["target_date"]}
            for r in rows
        ]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        issues = Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug).values(
            "id", "start_date", "target_date"
        )
        captured = 0
        for issue in issues:
            IssueBaseline.objects.update_or_create(
                issue_id=issue["id"],
                defaults={"start_date": issue["start_date"], "target_date": issue["target_date"]},
            )
            captured += 1
        return Response({"captured": captured}, status=status.HTTP_200_OK)


class ProjectAutoScheduleEndpoint(BaseAPIView):
    """Forward-cascade a project's dates along its dependencies (respect links).

    User-triggered, not automatic: pushes any successor that would start before
    its predecessor allows, preserving durations, and writes the moved dates back.
    Returns the list of rescheduled issues so the UI can report the count.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        issues, relations = _project_graph(project_id, slug)
        changed = cascade(issues, relations)
        moved = []
        for iid, dates in changed.items():
            # .update() bypasses per-issue activity/webhooks — intentional for a bulk reflow
            Issue.objects.filter(id=iid).update(start_date=dates["start"], target_date=dates["target"])
            moved.append(
                {"issue_id": iid, "start_date": dates["start"], "target_date": dates["target"]}
            )
        return Response({"rescheduled": len(moved), "issues": moved}, status=status.HTTP_200_OK)


class ProjectCriticalPathEndpoint(BaseAPIView):
    """The critical chain, and how much slack every other task has.

    `issue_ids` is kept for callers that only want the chain. `slack` is the more
    useful answer: "this can slip four days" is a decision, "this is not on the
    critical path" is trivia. Both come out of the same dates, so they cannot
    contradict each other.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        issues, relations = _project_graph(project_id, slug)
        slack = slack_for_issues(issues, relations)
        return Response(
            {
                "issue_ids": sorted(critical_path(issues, relations)),
                "slack": {
                    issue_id: {"free": v["free"], "total": v["total"], "critical": v["critical"]}
                    for issue_id, v in slack.items()
                },
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceCriticalPathEndpoint(BaseAPIView):
    """Program-level critical path + all sequencing edges across the caller's visible
    projects, INCLUDING cross-project dependencies (edges are found by issue
    membership, not project, so an A->B link across two projects is captured)."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        visible = _visible_projects(request, slug)
        # Only dated issues can be edges or on the critical path, so load just those —
        # keeps the relation IN() set small instead of every issue in every project.
        rows = list(
            Issue.issue_objects.filter(
                project__in=visible, start_date__isnull=False, target_date__isnull=False
            ).values("id", "start_date", "target_date", "project_id")
        )
        issues = {str(r["id"]): {"start": r["start_date"], "target": r["target_date"]} for r in rows}
        proj_of = {str(r["id"]): str(r["project_id"]) for r in rows}
        dated = {i for i, v in issues.items() if v["start"] and v["target"]}
        issue_ids = set(issues.keys())

        rels = (
            IssueRelation.objects.filter(relation_type__in=GANTT_RELATION_TYPES, deleted_at__isnull=True)
            .filter(Q(issue_id__in=issue_ids) | Q(related_issue_id__in=issue_ids))
            .values("issue_id", "related_issue_id", "relation_type")
        )
        relations = [
            {"issue_id": str(r["issue_id"]), "related_issue_id": str(r["related_issue_id"]), "relation_type": r["relation_type"]}
            for r in rels
        ]
        critical = critical_path(issues, relations)

        # Normalize to predecessor -> successor edges (build_edges applies the relation
        # direction), keep only edges between two dated (bar-drawable) issues, and flag
        # cross-project + critical (both endpoints on the critical path).
        edges = []
        for pred, succ, kind in build_edges(relations):
            if pred in dated and succ in dated:
                edges.append(
                    {
                        "from": pred,
                        "to": succ,
                        "kind": kind,
                        "cross_project": proj_of.get(pred) != proj_of.get(succ),
                        "critical": pred in critical and succ in critical,
                    }
                )

        return Response({"issue_ids": sorted(critical), "edges": edges}, status=status.HTTP_200_OK)


class ProjectWikiDocEndpoint(BaseAPIView):
    """Read or set the wiki doc a project links to (private deep link)."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        mapping = ProjectWikiDoc.objects.filter(project_id=project_id).first()
        if not mapping:
            return Response(
                {
                    "doc_id": None,
                    "workspace_id": None,
                    "title": None,
                    "google_drive_url": None,
                    "chat_url": None,
                    "github_repo_urls": [],
                },
                status=status.HTTP_200_OK,
            )
        return Response(self._serialize(mapping), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def put(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        mapping, _ = ProjectWikiDoc.objects.get_or_create(project_id=project_id)
        # Partial update: only touch a field when its key is present, so editing the
        # wiki link never wipes the Drive link (and vice-versa).
        if "doc_id" in request.data:
            doc_id = (request.data.get("doc_id") or "").strip() or None
            if doc_id and "/" in doc_id:  # accept a full wiki url or a bare doc id
                doc_id = doc_id.rstrip("/").split("/")[-1]
            mapping.doc_id = doc_id
        if "title" in request.data:
            mapping.title = (request.data.get("title") or "").strip() or None
        if "google_drive_url" in request.data:
            mapping.google_drive_url = (request.data.get("google_drive_url") or "").strip() or None
        if "chat_url" in request.data:
            mapping.chat_url = (request.data.get("chat_url") or "").strip() or None
        if "github_repo_urls" in request.data:
            raw = request.data.get("github_repo_urls") or []
            if not isinstance(raw, list):
                return Response({"error": "github_repo_urls must be a list"}, status=status.HTTP_400_BAD_REQUEST)
            # normalize: trimmed non-empty strings, de-duplicated, order preserved
            seen, urls = set(), []
            for u in raw:
                s = str(u).strip()
                if s and s not in seen:
                    seen.add(s)
                    urls.append(s)
            mapping.github_repo_urls = urls
        mapping.save()
        return Response(self._serialize(mapping), status=status.HTTP_200_OK)

    @staticmethod
    def _serialize(mapping):
        return {
            "doc_id": mapping.doc_id,
            "workspace_id": mapping.workspace_id,
            "title": mapping.title,
            "google_drive_url": mapping.google_drive_url,
            "chat_url": mapping.chat_url,
            "github_repo_urls": mapping.github_repo_urls or [],
        }


def _serialize_status(u):
    return {
        "id": str(u.id),
        "status": u.status,
        "message": u.message,
        "created_at": u.created_at,
        "author": getattr(u.created_by, "display_name", None) or getattr(u.created_by, "email", None),
    }


class ProjectStatusEndpoint(BaseAPIView):
    """Asana-style project status log: GET the recent updates, POST a new one."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        updates = ProjectStatusUpdate.objects.filter(
            project_id=project_id, project__workspace__slug=slug
        ).select_related("created_by")[:30]
        return Response([_serialize_status(u) for u in updates], status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        st = (request.data.get("status") or ProjectStatusUpdate.ON_TRACK).strip()
        if st not in {c[0] for c in ProjectStatusUpdate.STATUS_CHOICES}:
            return Response({"error": "invalid status"}, status=status.HTTP_400_BAD_REQUEST)
        project = _visible_projects(request, slug).filter(pk=project_id).first()
        if not project:
            return Response({"error": "project not found"}, status=status.HTTP_404_NOT_FOUND)
        update = ProjectStatusUpdate.objects.create(
            project=project,
            status=st,
            message=(request.data.get("message") or "").strip(),
            created_by=request.user,
        )
        return Response(_serialize_status(update), status=status.HTTP_201_CREATED)


class WorkspaceProjectStatusesEndpoint(BaseAPIView):
    """Latest status per project across the workspace (portfolio status pills)."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        latest = {}
        for u in (
            ProjectStatusUpdate.objects.filter(project__in=_visible_projects(request, slug))
            .order_by("project_id", "-created_at")
            .select_related("created_by")
        ):
            key = str(u.project_id)
            if key not in latest:
                latest[key] = _serialize_status(u)
        return Response(latest, status=status.HTTP_200_OK)


class ProjectTemplateCloneEndpoint(BaseAPIView):
    """Clone a project (used as a template) into a brand-new project: copies its
    states, work items (with parent links and dependencies), and — when a kickoff
    date is given — shifts every date so the earliest start lands on that date.
    Assignees, labels and estimates are intentionally not copied (a template is a
    plan, not an assignment). The source project is never modified."""

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        name = (request.data.get("name") or "").strip()
        identifier = (request.data.get("identifier") or "").strip().upper()
        kickoff = request.data.get("kickoff_date")

        if not name or not identifier:
            return Response({"error": "name and identifier are required"}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        # Scope the template to projects the caller is a member of (no Secret-project exfil).
        template = _visible_projects(request, slug).filter(pk=project_id).first()
        if not template:
            return Response({"error": "template project not found"}, status=status.HTTP_404_NOT_FOUND)

        # Validate name/identifier before opening the transaction.
        serializer = ProjectSerializer(data={"name": name, "identifier": identifier}, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # The whole clone runs in one transaction: a mid-way failure rolls back cleanly
        # instead of leaving an orphaned partial project (with a now-taken identifier).
        with transaction.atomic():
            serializer.save()
            new_project = Project.objects.get(pk=serializer.data["id"])
            ProjectMember.objects.get_or_create(
                project=new_project, member=request.user, defaults={"role": ROLE.ADMIN.value}
            )

            # Copy the template's states so state mapping is 1:1 (keeps custom workflows).
            state_map = {}
            for st in State.objects.filter(project=template):
                state_map[st.id] = State.objects.create(
                    name=st.name,
                    color=st.color,
                    group=st.group,
                    sequence=st.sequence,
                    project=new_project,
                    workspace=workspace,
                    default=st.default,
                    created_by=request.user,
                )

            # Work out the date shift: earliest template start (or target) -> kickoff.
            tmpl_issues = list(
                Issue.issue_objects.filter(project=template, deleted_at__isnull=True).order_by("sort_order", "created_at")
            )
            shift_days = None
            if kickoff:
                starts = [i.start_date for i in tmpl_issues if i.start_date]
                targets = [i.target_date for i in tmpl_issues if i.target_date]
                anchor = min(starts) if starts else (min(targets) if targets else None)
                if anchor:
                    try:
                        parts = [int(x) for x in str(kickoff)[:10].split("-")]
                        shift_days = (date(parts[0], parts[1], parts[2]) - anchor).days
                    except (ValueError, TypeError, IndexError):
                        shift_days = None

            def _shift(d):
                return d + timedelta(days=shift_days) if (d and shift_days is not None) else d

            # Clone the work items (Issue.save() assigns fresh sequence_id/sort_order).
            issue_map = {}
            for src in tmpl_issues:
                issue_map[src.id] = Issue.objects.create(
                    name=src.name,
                    description_json=src.description_json,
                    description_html=src.description_html,
                    description_binary=src.description_binary,
                    priority=src.priority,
                    state=state_map.get(src.state_id),
                    start_date=_shift(src.start_date),
                    target_date=_shift(src.target_date),
                    project=new_project,
                    workspace=workspace,
                    created_by=request.user,
                )

            # Re-link parents via .update() (bypasses save() side effects / re-sequencing).
            for src in tmpl_issues:
                if src.parent_id and src.parent_id in issue_map:
                    Issue.objects.filter(pk=issue_map[src.id].id).update(parent_id=issue_map[src.parent_id].id)

            # Recreate dependency edges among the cloned items only.
            rel_created = 0
            for r in IssueRelation.objects.filter(issue__in=[i.id for i in tmpl_issues]):
                a = issue_map.get(r.issue_id)
                b = issue_map.get(r.related_issue_id)
                if a and b:
                    IssueRelation.objects.create(
                        issue=a,
                        related_issue=b,
                        relation_type=r.relation_type,
                        project=new_project,
                        workspace=workspace,
                        created_by=request.user,
                    )
                    rel_created += 1

        return Response(
            {
                "project_id": str(new_project.id),
                "identifier": new_project.identifier,
                "issues_created": len(issue_map),
                "relations_created": rel_created,
                "date_shifted": shift_days is not None,
            },
            status=status.HTTP_201_CREATED,
        )


class MyWorkEndpoint(BaseAPIView):
    """The requesting user's open assigned work items across the workspace, with
    dates — feeds the Home 'My tasks' widget (grouped overdue / this week / later)."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        # Through IssueAssignee, never the `assignees` m2m. Django does not apply a
        # through model's manager to an m2m join, so `assignees=request.user` matches
        # SOFT-DELETED assignment rows too — and upstream's issue serializer deletes
        # and re-inserts every assignee row on each edit, so they pile up. The m2m
        # version returned an item once per historical assignment and kept returning
        # it long after the person was taken off, until the [:150] slice was full of
        # work nobody owned.
        assigned_ids = IssueAssignee.objects.filter(
            assignee=request.user, deleted_at__isnull=True
        ).values_list("issue_id", flat=True)
        issues = (
            Issue.issue_objects.filter(workspace__slug=slug, id__in=assigned_ids, deleted_at__isnull=True)
            .exclude(state__group__in=["completed", "cancelled"])
            .select_related("project")
            .values(
                "id",
                "name",
                "target_date",
                "priority",
                "sequence_id",
                "project_id",
                "project__identifier",
                "project__name",
            )
            .order_by("target_date")[:150]
        )
        payload = [
            {
                "id": str(i["id"]),
                "name": i["name"],
                "target_date": i["target_date"],
                "priority": i["priority"],
                "sequence_id": i["sequence_id"],
                "project_id": str(i["project_id"]),
                "project_identifier": i["project__identifier"],
                "project_name": i["project__name"],
            }
            for i in issues
        ]
        return Response(payload, status=status.HTTP_200_OK)


class WorkloadEndpoint(BaseAPIView):
    """Per-person load across the workspace: how much active work each member
    carries, what's overdue, and what's due this week. Data already exists
    (assignees + dates + estimate points); this just aggregates it."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        # Scope to the caller's own projects so Secret-project load doesn't leak.
        agg = _load_by_assignee(_visible_projects(request, slug))
        members = WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list(
            "member_id", flat=True
        )
        users = {u.id: u for u in User.objects.filter(id__in=list(members))}
        payload = []
        for uid, user in users.items():
            a = agg.get(str(uid), {})
            payload.append(
                {
                    "user_id": str(uid),
                    "name": user.display_name or user.first_name or user.email,
                    "email": user.email,
                    "avatar": getattr(user, "avatar_url", None) or user.avatar,
                    "assigned": a.get("assigned", 0),
                    "overdue": a.get("overdue", 0),
                    "due_week": a.get("due_week", 0),
                    "points": a.get("points") or 0,
                }
            )
        payload.sort(key=lambda x: -x["assigned"])
        return Response(payload, status=status.HTTP_200_OK)


class AdoptIssuesEndpoint(BaseAPIView):
    """Adopt inbox items (e.g. GitHub → GHIN) into a real project, losslessly.

    Plane CE cannot move an issue across projects. Instead this creates a copy in
    the target project, links it back to the original (relates_to), and marks the
    original as completed — so nothing is lost, traceability stays, and the GitHub
    cron (which dedups on existence) won't recreate a duplicate.

    Optional `target_parent_id`: when given, each copy is created as a sub-issue of
    that work item — this is how a single work item comes to "contain" several
    GitHub tasks. The parent must live in the target project (Plane CE only allows
    same-project parents).
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        source_ids = request.data.get("source_issue_ids", [])
        target_project_id = request.data.get("target_project_id")
        if not source_ids or not target_project_id:
            return Response({"error": "source_issue_ids and target_project_id required"}, status=status.HTTP_400_BAD_REQUEST)
        target = _visible_projects(request, slug).filter(id=target_project_id).first()
        if not target:
            return Response({"error": "target project not found"}, status=status.HTTP_404_NOT_FOUND)

        # Optional: nest the adopted copies under an existing work item in the target
        # project, so that work item ends up containing several GitHub tasks.
        parent = None
        target_parent_id = request.data.get("target_parent_id")
        if target_parent_id:
            parent = Issue.issue_objects.filter(project=target, id=target_parent_id).first()
            if not parent:
                return Response(
                    {"error": "target_parent_id must be a work item in the target project"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        visible = _visible_projects(request, slug)
        adopted = []
        for sid in source_ids:
            # A malformed request could list the parent itself as a source; adopting it
            # would nest a self-copy and (worse) mark the intended container completed.
            if parent and str(sid) == str(parent.id):
                continue
            # Scope sources to the caller's own projects — both the copy (read) and the
            # completed-state write must stay inside projects they're a member of.
            src = Issue.issue_objects.filter(project__in=visible, id=sid).first()
            if not src:
                continue
            # save() assigns sequence_id + the target project's default state
            new_issue = Issue.objects.create(
                workspace=target.workspace,
                project=target,
                name=src.name,
                description_html=src.description_html,
                priority=src.priority,
                parent=parent,
                created_by=request.user,
            )
            IssueRelation.objects.get_or_create(
                issue=new_issue,
                related_issue=src,
                defaults={"relation_type": "relates_to", "project": target, "workspace": target.workspace},
            )
            done = State.objects.filter(project=src.project, group="completed").first()
            if done:
                src.state = done
                # include completed_at: Issue.save() sets it from the state group, but
                # update_fields=["state"] alone would drop it (breaks burndown/velocity).
                src.completed_at = timezone.now()
                src.save(update_fields=["state", "completed_at"])
            adopted.append({"source_id": str(sid), "new_issue_id": str(new_issue.id), "sequence_id": new_issue.sequence_id})
        return Response(
            {"adopted": len(adopted), "issues": adopted, "parent_id": str(parent.id) if parent else None},
            status=status.HTTP_200_OK,
        )


class GithubInboxEndpoint(BaseAPIView):
    """Open items sitting in a GitHub-inbox (GHIN) project.

    Powers the "link GitHub tasks to this work item" picker: the caller lists open
    GHIN tasks, selects some, then POSTs them to adopt-issues with target_parent_id
    set to the work item. Scoped to the caller's own projects (IDOR-safe).
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        visible = _visible_projects(request, slug)
        rows = (
            Issue.issue_objects.filter(
                project__in=visible, project__identifier="GHIN", workspace__slug=slug
            )
            .exclude(state__group__in=["completed", "cancelled"])
            .order_by("-created_at")
            .values("id", "name", "sequence_id", "description_html", "project__identifier", "state__name")[:200]
        )
        items = [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "sequence_id": r["sequence_id"],
                "project_identifier": r["project__identifier"],
                "state": r["state__name"],
                "github_url": _github_url(r["description_html"]),
            }
            for r in rows
        ]
        return Response(items, status=status.HTTP_200_OK)


class HubProjectsEndpoint(BaseAPIView):
    """All non-archived projects with task counts, progress, and the links defined
    in each project's docs note (Wiki / Drive / Chat / GitHub) — powers the
    dashboard Team-Hub project directory. Server-to-server: authed by the shared
    HUB_LINKS_SECRET header, not a user session (the caller is the dashboard, which
    has no Plane session)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    WIKI_BASE = "https://docs.arribada.org"
    PLANE_BASE = "https://plane.arribada.org"

    def get(self, request, slug):
        secret = os.environ.get("HUB_LINKS_SECRET")
        if not secret:
            return Response({"error": "not_configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if request.headers.get("X-Hub-Secret") != secret:
            return Response({"error": "unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)

        projects = list(
            Project.objects.filter(workspace__slug=slug, archived_at__isnull=True).values("id", "name", "identifier")
        )
        pids = [p["id"] for p in projects]
        agg = {
            r["project_id"]: r
            for r in Issue.issue_objects.filter(project_id__in=pids)
            .values("project_id")
            .annotate(total=Count("id"), completed=Count("id", filter=Q(state__group="completed")))
        }
        docs = {d.project_id: d for d in ProjectWikiDoc.objects.filter(project_id__in=pids)}

        out = []
        for p in projects:
            pid = p["id"]
            a = agg.get(pid, {})
            total = a.get("total", 0)
            completed = a.get("completed", 0)
            d = docs.get(pid)
            wiki_url = (
                f"{self.WIKI_BASE}/{d.workspace_id}/{d.doc_id}"
                if d and d.doc_id and d.workspace_id
                else None
            )
            out.append(
                {
                    "project_id": str(pid),
                    "name": p["name"],
                    "identifier": p["identifier"],
                    "plane_url": f"{self.PLANE_BASE}/{slug}/projects/{pid}/issues/",
                    "total_issues": total,
                    "completed_issues": completed,
                    "progress": round(100 * completed / total) if total else 0,
                    "wiki_url": wiki_url,
                    "google_drive_url": (d.google_drive_url if d else None) or None,
                    "chat_url": (d.chat_url if d else None) or None,
                    "github_repo_urls": (d.github_repo_urls if d else []) or [],
                }
            )
        out.sort(key=lambda x: (-x["total_issues"], x["name"].lower()))
        return Response(out, status=status.HTTP_200_OK)


class TeamSyncEndpoint(BaseAPIView):
    """Push project leads and their disciplines from the wiki into the Plane roster.

    Server-to-server: the caller is a cron on the wiki host, which has no Plane
    session — same shared-secret auth as HubProjectsEndpoint above.

    Every entry that cannot be placed comes back in `unmatched` instead of raising. A
    cron that 500s on one renamed project stops syncing the other nineteen, and nobody
    notices for a week; a report the caller can log is worth more than a hard failure.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, slug):
        secret = os.environ.get("HUB_LINKS_SECRET")
        if not secret:
            return Response({"error": "not_configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if request.headers.get("X-Hub-Secret") != secret:
            return Response({"error": "unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)

        entries = request.data.get("entries")
        if not isinstance(entries, list):
            return Response({"error": "entries must be a list"}, status=status.HTTP_400_BAD_REQUEST)

        projects = {str(p.id): p for p in Project.objects.filter(workspace__slug=slug)}
        by_identifier = {}
        for project in projects.values():
            by_identifier.setdefault((project.identifier or "").strip().upper(), project)
        # The wiki knows a project by the node id of its page, so that is a third way in
        # — the cron does not have to carry Plane UUIDs around to be useful.
        by_node = {
            str(d.doc_id): str(d.project_id)
            for d in ProjectWikiDoc.objects.filter(project__workspace__slug=slug)
            if d.doc_id
        }

        def resolve_project(entry):
            explicit = str(entry.get("project_id") or "").strip()
            if explicit and explicit in projects:
                return projects[explicit]
            identifier = str(entry.get("project_identifier") or "").strip().upper()
            if identifier and identifier in by_identifier:
                return by_identifier[identifier]
            node = str(entry.get("wiki_node_id") or "").strip()
            if node and node in by_node:
                return projects.get(by_node[node])
            return None

        # One query for every address in the batch, rather than one per entry.
        users = _users_by_email(slug, [e.get("email") for e in entries if isinstance(e, dict)])

        matched, updated, unmatched = 0, 0, []
        touched = {}

        def reject(entry, reason):
            unmatched.append(
                {
                    "name": str(entry.get("name") or "") if isinstance(entry, dict) else "",
                    "email": str(entry.get("email") or "") if isinstance(entry, dict) else "",
                    "project_id": str(entry.get("project_id") or "") if isinstance(entry, dict) else "",
                    "project_identifier": str(entry.get("project_identifier") or "")
                    if isinstance(entry, dict)
                    else "",
                    "wiki_node_id": str(entry.get("wiki_node_id") or "") if isinstance(entry, dict) else "",
                    "reason": reason,
                }
            )

        for entry in entries:
            if not isinstance(entry, dict):
                reject({}, "entry is not an object")
                continue
            name = str(entry.get("name") or "").strip()[:255]
            email = str(entry.get("email") or "").strip().lower()[:255]
            if not name and not email:
                reject(entry, "no name")
                continue
            if not name:
                name = email
            project = resolve_project(entry)
            if not project:
                reject(entry, "project not found")
                continue
            matched += 1

            # Match a person by address first. Falling back to the name is only safe
            # against a roster row that has no address yet — a row carrying a different
            # address is a different person, not a rename, and merging two people is a
            # far worse outcome than creating one duplicate row.
            if email:
                row = ProjectTeamMember.objects.filter(project=project, email__iexact=email).first()
                if row is None:
                    row = ProjectTeamMember.objects.filter(
                        project=project, email="", name__iexact=name
                    ).first()
            else:
                row = ProjectTeamMember.objects.filter(project=project, name__iexact=name).first()
            creating = row is None
            if creating:
                row = ProjectTeamMember(project=project, source=ProjectTeamMember.WIKI)

            before = (row.name, row.email, list(row.roles or []), row.is_lead, row.member_id)
            row.name = name
            # Only ever *adds* an address: the wiki not knowing someone's email must
            # never erase one Plane already has.
            if email:
                row.email = email
                # Linking on an address that belongs to a real workspace member is not
                # inventing a Plane user — it is exactly the key the model exists to
                # link on. Anything else leaves member null and the row stays truthful.
                user = users.get(email)
                if user is not None:
                    row.member_id = user.id
            roles = entry.get("roles")
            if isinstance(roles, list):
                row.roles = _clean_roles(roles)
            is_lead = bool(entry.get("is_lead", True))
            row.is_lead = is_lead
            written = 0
            try:
                # Savepoint per entry: a collision on one person must not abort the run
                # or leave the connection in a broken transaction for the next entry.
                with transaction.atomic():
                    if creating or before != (
                        row.name,
                        row.email,
                        list(row.roles or []),
                        row.is_lead,
                        row.member_id,
                    ):
                        row.save()
                        written += 1
                    if is_lead:
                        # The wiki's Project Leaders table is the register of record for
                        # who leads what, so naming a lead here means "this person, not
                        # the one who used to be" — otherwise a handover leaves two
                        # leads on the project forever.
                        written += (
                            ProjectTeamMember.objects.filter(project=project, is_lead=True)
                            .exclude(id=row.id)
                            .update(is_lead=False)
                        )
            except IntegrityError:
                # Rolled back, so nothing was written — report the entry instead.
                matched -= 1
                reject(entry, "conflicts with an existing roster entry")
                continue
            updated += written
            if written:
                touched[str(project.id)] = project

        # The wiki is where a handover is recorded, so this is the pass that actually
        # moves work when a project changes hands: every item asking for a discipline
        # goes to whoever now holds it. Only projects this run wrote to.
        reassigned = 0
        for touched_project in touched.values():
            # No user is signing this — the caller is a cron with no Plane session — so
            # the activity is attributed to the project lead, falling back to whoever
            # created the project.
            actor_id = touched_project.project_lead_id or touched_project.created_by_id
            reassigned += len(_materialise_issue_roles(touched_project, actor_id))

        return Response(
            # `matched` counts entries that found a project; `updated` counts roster
            # rows actually written, so a no-op sync answers matched=n, updated=0.
            # `reassigned` counts work items that gained an owner from the new roster.
            {
                "matched": matched,
                "updated": updated,
                "reassigned": reassigned,
                "unmatched": unmatched,
            },
            status=status.HTTP_200_OK,
        )


class ProjectFoldersEndpoint(BaseAPIView):
    """Workspace-shared folders that group projects in the sidebar."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        folders = ProjectFolder.objects.filter(workspace__slug=slug).values(
            "id", "name", "parent_id", "sort_order"
        )
        items = ProjectFolderItem.objects.filter(folder__workspace__slug=slug).values(
            "folder_id", "project_id", "sort_order"
        )
        by_folder = defaultdict(list)
        for it in sorted(items, key=lambda x: x["sort_order"]):
            by_folder[str(it["folder_id"])].append(str(it["project_id"]))
        return Response(
            [
                {
                    "id": str(f["id"]),
                    "name": f["name"],
                    "parent_id": str(f["parent_id"]) if f["parent_id"] else None,
                    "sort_order": f["sort_order"],
                    "project_ids": by_folder.get(str(f["id"]), []),
                }
                for f in folders
            ],
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        parent_id = request.data.get("parent_id")
        folder = ProjectFolder.objects.create(workspace=workspace, name=name, parent_id=parent_id or None)
        return Response({"id": str(folder.id), "name": folder.name}, status=status.HTTP_201_CREATED)


class ProjectFolderDetailEndpoint(BaseAPIView):
    """Rename/move (PATCH) or delete (DELETE) a shared folder."""

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, folder_id):
        folder = ProjectFolder.objects.filter(workspace__slug=slug, id=folder_id).first()
        if not folder:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            folder.name = (request.data.get("name") or "").strip() or folder.name
        if "sort_order" in request.data:
            folder.sort_order = request.data["sort_order"]
        folder.save()
        return Response({"id": str(folder.id), "name": folder.name}, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, folder_id):
        deleted, _ = ProjectFolder.objects.filter(workspace__slug=slug, id=folder_id).delete()
        return Response({"deleted": bool(deleted)}, status=status.HTTP_200_OK)


class ProjectFolderAssignEndpoint(BaseAPIView):
    """Put a project into a folder, or remove it (folder_id null)."""

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def put(self, request, slug):
        project_id = request.data.get("project_id")
        folder_id = request.data.get("folder_id")
        if not project_id:
            return Response({"error": "project_id required"}, status=status.HTTP_400_BAD_REQUEST)
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "project not found"}, status=status.HTTP_404_NOT_FOUND)
        if not folder_id:
            ProjectFolderItem.objects.filter(project_id=project_id).delete()
            return Response({"project_id": str(project_id), "folder_id": None}, status=status.HTTP_200_OK)
        if not ProjectFolder.objects.filter(workspace__slug=slug, id=folder_id).exists():
            return Response({"error": "folder not found"}, status=status.HTTP_404_NOT_FOUND)
        ProjectFolderItem.objects.update_or_create(
            project_id=project_id, defaults={"folder_id": folder_id}
        )
        return Response({"project_id": str(project_id), "folder_id": str(folder_id)}, status=status.HTTP_200_OK)


class ProjectScheduleEndpoint(BaseAPIView):
    """Read or set a project's planned range."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response(
                {"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND
            )
        schedule, _ = ProjectSchedule.objects.get_or_create(project_id=project_id)
        return Response(
            ProjectScheduleSerializer(schedule).data, status=status.HTTP_200_OK
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response(
                {"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND
            )
        schedule, _ = ProjectSchedule.objects.get_or_create(project_id=project_id)
        serializer = ProjectScheduleSerializer(schedule, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProjectTeamEndpoint(BaseAPIView):
    """Read or replace who works on a project and what they do on it.

    The roster is people, not accounts (see ProjectTeamMember): it stays useful on an
    instance with two Plane users and a team of twenty, and it is what lets the
    planning assistant send firmware work to the firmware engineer.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "roles_vocabulary": [{"value": v, "label": label} for v, label in PROJECT_ROLES],
                "team": _team_rows(project_id),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def put(self, request, slug, project_id):
        from plane.utils.host import base_host

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        payload = request.data.get("team")
        if not isinstance(payload, list):
            return Response({"error": "team must be a list"}, status=status.HTTP_400_BAD_REQUEST)

        cleaned, seen = [], set()
        for row in payload:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()[:255]
            email = str(row.get("email") or "").strip().lower()[:255]
            if not name and not email:
                continue
            if not name:
                name = email
            # A roster is a set of people. Two rows for the same person would trip the
            # partial unique index mid-write, so collapse them here and keep the first.
            key = ("email", email) if email else ("name", name.lower())
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(
                {
                    "id": str(row.get("id") or "").strip(),
                    "member_id": str(row.get("member_id") or "").strip(),
                    "name": name,
                    "email": email,
                    "roles": _clean_roles(row.get("roles")),
                    "is_lead": bool(row.get("is_lead")),
                }
            )

        # An explicit member_id is only honoured for someone who actually has an active
        # account in this workspace — otherwise `in_plane` would claim a Plane user that
        # nobody can be assigned to, or point at an account outside the workspace.
        wanted_members = _uuid_list(c["member_id"] for c in cleaned)
        allowed_members = (
            {
                str(m)
                for m in WorkspaceMember.objects.filter(
                    workspace__slug=slug, is_active=True, member_id__in=wanted_members
                ).values_list("member_id", flat=True)
            }
            if wanted_members
            else set()
        )
        # Nobody typed a member_id? Then link on the address, the key the model exists
        # for — with two accounts and twenty people, doing it by hand would never happen.
        by_email = _users_by_email(slug, [c["email"] for c in cleaned if c["email"]])

        existing = list(ProjectTeamMember.objects.filter(project_id=project_id))
        by_id = {str(r.id): r for r in existing}
        by_row_email = {r.email.lower(): r for r in existing if r.email}
        # Name matching only ever claims a row that has no address yet. A row that
        # already carries one is a known person, and quietly stripping their address
        # because someone re-typed the same name is not a trade worth making.
        by_row_name = {}
        for r in existing:
            if not r.email:
                by_row_name.setdefault(r.name.strip().lower(), r)

        resolved, keep = [], set()
        for c in cleaned:
            row = by_id.get(c["id"])
            if row is None and c["email"]:
                row = by_row_email.get(c["email"])
            if row is None and not c["email"]:
                row = by_row_name.get(c["name"].lower())
            if row is None or str(row.id) in keep:
                row = ProjectTeamMember(project_id=project_id, source=ProjectTeamMember.MANUAL)
            row.name = c["name"]
            row.email = c["email"]
            row.roles = c["roles"]
            row.is_lead = c["is_lead"]
            # An unusable member_id falls back to the address rather than dropping the
            # link entirely — the address is the more durable of the two.
            member_id = c["member_id"] if c["member_id"] in allowed_members else ""
            if not member_id and c["email"] in by_email:
                member_id = str(by_email[c["email"]].id)
            row.member_id = member_id or None
            resolved.append(row)
            keep.add(str(row.id))

        try:
            with transaction.atomic():
                # Full replace: drop whoever is no longer on the list *before* writing,
                # so a person renamed onto a freed name does not collide with the row
                # that is about to disappear.
                ProjectTeamMember.objects.filter(project_id=project_id).exclude(id__in=list(keep)).delete()
                for row in resolved:
                    row.save()
        except IntegrityError:
            # Two people swapping names in one request is the realistic way to get here.
            return Response(
                {"error": "Two roster entries collide on the same person; give them distinct names or emails."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # A roster edit is exactly the event that changes who holds a discipline, so the
        # work items asking for one follow it here. Outside the transaction above: this
        # fans out notifications, and a slow queue must not hold a write lock on the
        # roster — and a failure here has not lost the roster edit.
        repointed = _materialise_issue_roles(
            project, request.user.id, origin=base_host(request=request, is_app=True)
        )

        return Response(
            {
                "roles_vocabulary": [{"value": v, "label": label} for v, label in PROJECT_ROLES],
                "team": _team_rows(project_id),
                # How many work items the roster edit just handed to somebody.
                "reassigned": len(repointed),
            },
            status=status.HTTP_200_OK,
        )


class ProjectOverviewEndpoint(BaseAPIView):
    """Everything the project Overview page shows, in one call.

    The alternative was five round trips (issues, cycles, modules, pages, links)
    plus client-side aggregation on data the client doesn't otherwise need; the
    counts are cheap grouped queries here and expensive fan-out there. Warnings
    are computed server-side too, so "no GitHub repo linked" means the same thing
    in the UI, in the Team-Hub and in any future digest.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        from plane.db.models import Cycle, Module, ProjectPage

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        today = timezone.now().date()
        week = today + timedelta(days=7)
        issues = Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug)

        still_open = ~Q(state__group__in=["completed", "cancelled"])
        counts = issues.aggregate(
            total=Count("id"),
            completed=Count("id", filter=Q(state__group="completed")),
            started=Count("id", filter=Q(state__group="started")),
            unstarted=Count("id", filter=Q(state__group="unstarted")),
            backlog=Count("id", filter=Q(state__group="backlog")),
            cancelled=Count("id", filter=Q(state__group="cancelled")),
            undated=Count("id", filter=Q(start_date__isnull=True, target_date__isnull=True)),
            overdue=Count("id", filter=Q(target_date__lt=today) & still_open),
            due_week=Count("id", filter=Q(target_date__gte=today, target_date__lte=week) & still_open),
            derived_start=Min("start_date"),
            derived_target=Max("target_date"),
        )
        # Separate query on purpose: `assignees` is a m2m, so joining it inside the
        # aggregate above would duplicate a row per assignee and inflate every count.
        # Counted through the join table rather than `assignees__isnull=True`: assignee
        # rows are soft-deleted, and a m2m join does not apply the through model's
        # manager, so an issue whose only assignee was removed still looks assigned.
        assigned_issue_ids = IssueAssignee.objects.filter(
            issue__project_id=project_id, deleted_at__isnull=True
        ).values("issue_id")
        unassigned = issues.filter(still_open).exclude(id__in=assigned_issue_ids).count()

        # Work items asking for a discipline nobody on the roster can be given work in.
        # Not a bug and not the same thing as `unassigned`: the requirement is recorded
        # and correct, there simply is no account to hand it to yet — which is the
        # normal state of this instance and the one thing the Overview must say out loud,
        # because otherwise it reads as the assistant having quietly done nothing.
        holders = _role_holders(project_id)
        roles_pending = len(
            {
                str(issue_id)
                for issue_id, role in IssueRole.objects.filter(
                    issue__project_id=project_id, issue__deleted_at__isnull=True
                ).values_list("issue_id", "role")
                if str(role).strip().lower() not in holders
            }
        )

        # Cycles and their roll-up: two grouped queries, not one per cycle.
        cycle_rows = list(
            Cycle.objects.filter(project_id=project_id, archived_at__isnull=True)
            .order_by("start_date", "-created_at")
            .values("id", "name", "start_date", "end_date")[:50]
        )
        # Aggregated from Issue.issue_objects rather than CycleIssue so archived, draft
        # and triage items are excluded — counting the join table directly makes this
        # page disagree with the Sprints page, which aggregates the same way as here.
        cycle_stats = {
            r["issue_cycle__cycle_id"]: r
            for r in Issue.issue_objects.filter(
                issue_cycle__cycle_id__in=[c["id"] for c in cycle_rows],
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(
                total=Count("id", distinct=True),
                completed=Count("id", filter=Q(state__group="completed"), distinct=True),
            )
        }
        cycles = []
        for c in cycle_rows:
            stats = cycle_stats.get(c["id"], {})
            start = c["start_date"].date() if c["start_date"] else None
            end = c["end_date"].date() if c["end_date"] else None
            cycles.append(
                {
                    "id": str(c["id"]),
                    "name": c["name"],
                    "start_date": start,
                    "end_date": end,
                    "total": stats.get("total", 0),
                    "completed": stats.get("completed", 0),
                    "is_active": bool(start and end and start <= today <= end),
                    "is_upcoming": bool(start and start > today),
                }
            )

        module_rows = list(
            Module.objects.filter(project_id=project_id, archived_at__isnull=True)
            .order_by("sort_order")
            .values("id", "name", "status", "start_date", "target_date")[:50]
        )
        # Same reasoning as the cycle roll-up above: aggregate the work items, not the
        # join table, so archived/draft/triage items don't inflate the Modules numbers.
        module_stats = {
            r["issue_module__module_id"]: r
            for r in Issue.issue_objects.filter(
                issue_module__module_id__in=[m["id"] for m in module_rows],
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(
                total=Count("id", distinct=True),
                completed=Count("id", filter=Q(state__group="completed"), distinct=True),
            )
        }
        modules = [
            {
                "id": str(m["id"]),
                "name": m["name"],
                "status": m["status"],
                "start_date": m["start_date"],
                "target_date": m["target_date"],
                "total": module_stats.get(m["id"], {}).get("total", 0),
                "completed": module_stats.get(m["id"], {}).get("completed", 0),
            }
            for m in module_rows
        ]

        # Same filter Plane's own project-pages endpoints apply: top-level pages only
        # (so the count matches what the Pages tab lists), and never another member's
        # private page — access=0 is public, anything else is the owner's alone.
        page_qs = ProjectPage.objects.filter(
            project_id=project_id,
            page__archived_at__isnull=True,
            page__parent__isnull=True,
        ).filter(Q(page__owned_by=request.user) | Q(page__access=0))
        recent_pages = [
            {
                "id": str(p["page_id"]),
                "name": p["page__name"] or "Untitled",
                "updated_at": p["page__updated_at"],
            }
            for p in page_qs.order_by("-page__updated_at").values(
                "page_id", "page__name", "page__updated_at"
            )[:5]
        ]

        docs = ProjectWikiDoc.objects.filter(project_id=project_id).first()
        wiki_url = (
            f"{HubProjectsEndpoint.WIKI_BASE}/{docs.workspace_id}/{docs.doc_id}"
            if docs and docs.doc_id and docs.workspace_id
            else None
        )
        links = {
            "wiki_url": wiki_url,
            "drive_url": (docs.google_drive_url if docs else None) or None,
            "chat_url": (docs.chat_url if docs else None) or None,
            "github_repo_urls": (docs.github_repo_urls if docs else []) or [],
        }

        schedule = ProjectSchedule.objects.filter(project_id=project_id).first()
        latest_status = (
            ProjectStatusUpdate.objects.filter(project_id=project_id)
            .select_related("created_by")
            .first()
        )

        total = counts.get("total") or 0
        warnings = []

        def warn(code, message, severity="warning"):
            warnings.append({"code": code, "message": message, "severity": severity})

        if not links["github_repo_urls"]:
            warn("no_github", "No GitHub repository is linked to this project.")
        if not links["wiki_url"]:
            warn("no_wiki", "No wiki page is linked - project documentation belongs in the wiki.")
        if not links["chat_url"]:
            warn("no_chat", "No chat channel is linked.", "info")
        if not (schedule and (schedule.start_date or schedule.target_date)):
            warn("no_project_dates", "This project has no planned start or end date.")
        elif schedule and schedule.target_date and schedule.target_date < today:
            warn("past_target", f"The planned end date ({schedule.target_date}) is in the past.")
        if counts.get("undated"):
            warn("undated_items", f"{counts['undated']} work item(s) have no dates.")
        if counts.get("overdue"):
            warn("overdue_items", f"{counts['overdue']} open work item(s) are past their due date.", "error")
        if unassigned:
            warn("unassigned_items", f"{unassigned} open work item(s) have no assignee.", "info")
        if roles_pending:
            warn(
                "roles_pending",
                f"{roles_pending} work item(s) need a discipline nobody on the roster can "
                "be given work in - add the person to the team, or invite them to Plane.",
                "info",
            )
        if project.cycle_view and not cycles:
            warn("no_cycles", "No sprint has been created yet.", "info")
        if not total:
            warn("no_items", "This project has no work items yet.", "info")
        if not (project.description or "").strip():
            warn("no_description", "This project has no description.", "info")

        return Response(
            {
                "project": {
                    "id": str(project.id),
                    "name": project.name,
                    "identifier": project.identifier,
                    "description": project.description,
                    "logo_props": project.logo_props,
                    "cycle_view": project.cycle_view,
                    "module_view": project.module_view,
                    "issue_views_view": project.issue_views_view,
                    "page_view": project.page_view,
                },
                "schedule": {
                    "start_date": schedule.start_date if schedule else None,
                    "target_date": schedule.target_date if schedule else None,
                },
                "derived": {
                    "start_date": counts.get("derived_start"),
                    "target_date": counts.get("derived_target"),
                },
                "items": {
                    "total": total,
                    "completed": counts.get("completed", 0),
                    "started": counts.get("started", 0),
                    "unstarted": counts.get("unstarted", 0),
                    "backlog": counts.get("backlog", 0),
                    "cancelled": counts.get("cancelled", 0),
                    "undated": counts.get("undated", 0),
                    "overdue": counts.get("overdue", 0),
                    "due_week": counts.get("due_week", 0),
                    "unassigned": unassigned,
                    "roles_pending": roles_pending,
                },
                "cycles": cycles,
                "modules": modules,
                "pages": {"count": page_qs.count(), "recent": recent_pages},
                "links": links,
                # Same shape the team endpoint returns, so the Overview keeps its
                # one-round-trip promise instead of the client chasing a second call.
                "team": _team_rows(project_id),
                "status": _serialize_status(latest_status) if latest_status else None,
                "member_count": ProjectMember.objects.filter(
                    project_id=project_id, is_active=True
                ).count(),
                "warnings": warnings,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceAiSettingsEndpoint(BaseAPIView):
    """Which LLM the planning assistant uses. The key is write-only: reads report
    whether one exists and where it came from, never what it is."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        from .ai import DEFAULT_PROVIDER, PROVIDERS, provider_choices, resolve_config

        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        row = WorkspaceAiSettings.objects.filter(workspace=workspace).first()
        active = resolve_config(workspace.id) or {}
        return Response(
            {
                "configured": bool(active),
                "provider": (row.provider if row else None) or active.get("provider") or DEFAULT_PROVIDER,
                "model": (row.model if row else "") or "",
                "base_url": (row.base_url if row else "") or "",
                "has_workspace_key": bool(row and row.encrypted_api_key),
                "source": active.get("source"),
                "active_model": active.get("model"),
                "providers": provider_choices(),
                "default_provider": DEFAULT_PROVIDER,
                "provider_defaults": {k: v["model"] for k, v in PROVIDERS.items()},
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def put(self, request, slug):
        from .ai import PROVIDERS, resolve_config

        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        row, _ = WorkspaceAiSettings.objects.get_or_create(workspace=workspace)

        if "provider" in request.data:
            provider = (request.data.get("provider") or "").strip().lower()
            if provider not in PROVIDERS:
                return Response({"error": "unknown provider"}, status=status.HTTP_400_BAD_REQUEST)
            row.provider = provider
        if "model" in request.data:
            row.model = (request.data.get("model") or "").strip()
        if "base_url" in request.data:
            row.base_url = (request.data.get("base_url") or "").strip()
        # "custom" has no default endpoint, so a blank base URL would let the OpenAI
        # SDK fall back to api.openai.com and post this workspace's private key there.
        # Checked on the resulting row, so clearing the URL of a custom row fails too.
        if row.provider == "custom" and not (row.base_url or "").strip():
            return Response(
                {"error": "A base URL is required for the custom (OpenAI-compatible) provider."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if "api_key" in request.data:
            # An empty string clears the key (falling back to the deploy-wide one);
            # the sentinel means "leave it alone", so the UI can save a model change
            # without asking the user to retype a secret it was never shown.
            raw = request.data.get("api_key")
            if raw != "__unchanged__":
                row.set_api_key((raw or "").strip())
        row.updated_by = request.user
        row.save()

        active = resolve_config(workspace.id) or {}
        return Response(
            {
                "configured": bool(active),
                "provider": row.provider,
                "model": row.model,
                "base_url": row.base_url,
                "has_workspace_key": bool(row.encrypted_api_key),
                "source": active.get("source"),
                "active_model": active.get("model"),
            },
            status=status.HTTP_200_OK,
        )


def _parse_date(value):
    """'YYYY-MM-DD' -> date, or None. Models like to append a time or a comment."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


class ProjectAiPlanEndpoint(BaseAPIView):
    """Ask the model to complete a project's work items: dates, and an owner.

    Two modes. With no `issue_ids` it takes the project's undated items, which is the
    project-setup case. With `issue_ids` it takes exactly those items whether or not
    they already have dates - the motivating case being a batch just imported from
    GitHub, where the dates came across but nobody owns anything.

    It only ever *proposes*: the response is a list of suggestions with a one-line
    rationale each, which the UI shows for review. Nothing here writes to an issue -
    applying is a separate, explicit call.

    Every assignment also carries a `role` - the discipline the work needs. That is what
    makes the assistant useful at all on this instance: there are two Plane accounts and
    twenty people on the team, so on most projects there is nobody the model is allowed
    to name and an assignee-only answer would come back empty every time. The discipline
    is always answerable, it is recorded on the item, and it turns into a real assignment
    by itself the day someone holding it gets an account.
    """

    SYSTEM = (
        "You are a project scheduler for a conservation-technology engineering team. "
        "Given a project window, its work items, their likely durations, their "
        "dependencies and the people on the team, you give every item you are asked "
        "about a start date, a target date, a discipline and an owner. Rules: use ISO "
        "dates (YYYY-MM-DD); never start an item before a dependency it is blocked by "
        "has finished; keep every date inside the project window when one is given; "
        "prefer Monday-Friday for start dates; give shorter durations to small items and "
        "longer ones to items with many sub-items; never invent work items. "
        "For the owner, match the work to the discipline - firmware work to the "
        "embedded firmware engineer, a schematic or a PCB to the hardware engineer, an "
        "enclosure to the mechanical engineer, a deployment to field ops - and spread "
        "the work across the team instead of piling it on one person, taking their "
        "current load into account. Use only the P-refs listed under Team, and return "
        'assignee_ref: null when you genuinely cannot tell who should own an item. '
        "Always answer `role` as well, chosen from the Disciplines list you are given: "
        "most of this team has no account on this instance, so when no candidate fits - "
        "or nobody is assignable at all - naming the discipline the work needs is the "
        "answer, and it is what gets the item to the right person later. Return "
        "role: null only for an item that needs no particular discipline. "
        "Reply with JSON only, no prose, in exactly this shape: "
        '{"assignments":[{"ref":"T1","start_date":"YYYY-MM-DD","target_date":"YYYY-MM-DD",'
        '"assignee_ref":"P1","role":"embedded firmware","reason":"one short sentence"}],'
        '"notes":"one short paragraph"}'
    )

    # How many work items one request may describe to the model. A hard cap, so the
    # prompt (and the answer budget derived from it) stays bounded on a huge project.
    MAX_ITEMS = 300
    ROW_FIELDS = (
        "id",
        "name",
        "sequence_id",
        "start_date",
        "target_date",
        "priority",
        "parent_id",
        "state__group",
    )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        from .ai import chat_json, resolve_config

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        config = resolve_config(project.workspace_id)
        if not config:
            return Response(
                {"error": "No AI provider is configured for this workspace."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule = ProjectSchedule.objects.filter(project_id=project_id).first()
        window_start = _parse_date(request.data.get("start_date")) or (schedule.start_date if schedule else None)
        window_end = _parse_date(request.data.get("target_date")) or (schedule.target_date if schedule else None)
        try:
            raw_days = request.data.get("default_duration_days")
            default_days = max(1, min(90, int(raw_days))) if raw_days is not None else 5
        except (TypeError, ValueError):
            default_days = 5

        base = (
            Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug)
            .exclude(state__group="cancelled")
            .order_by("sequence_id")
        )
        # An explicit selection wins over "whatever has no dates": the caller has just
        # imported a batch and knows which items need finishing, dated or not.
        raw_chosen = request.data.get("issue_ids")
        chosen_ids = _uuid_list(raw_chosen if isinstance(raw_chosen, list) else [])
        explicit = bool(chosen_ids)
        # The items to complete are the whole point of the request, so they claim the
        # budget first and the rest only fill what is left (as dependency context).
        # Slicing one sequence_id-ordered query instead would answer "everything is
        # already scheduled" on any project whose oldest N items happen to be dated.
        if explicit:
            target_qs = base.filter(id__in=chosen_ids)
            context_qs = base.exclude(id__in=chosen_ids)
        else:
            target_qs = base.filter(start_date__isnull=True, target_date__isnull=True)
            context_qs = base.exclude(start_date__isnull=True, target_date__isnull=True)
        target_total = target_qs.count()
        context_total = context_qs.count()
        target_rows = list(target_qs.values(*self.ROW_FIELDS)[: self.MAX_ITEMS])
        context_rows = list(context_qs.values(*self.ROW_FIELDS)[: self.MAX_ITEMS - len(target_rows)])
        # Bounded on purpose: the prompt must not grow with the size of the project.
        truncated = target_total > len(target_rows) or context_total > len(context_rows)
        rows = sorted(target_rows + context_rows, key=lambda r: r["sequence_id"])
        if not rows:
            return Response({"error": "This project has no work items."}, status=status.HTTP_400_BAD_REQUEST)
        if explicit and not target_rows:
            return Response(
                {"error": "None of the selected work items belong to this project."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_ids = {str(r["id"]) for r in target_rows}
        ref_of = {str(r["id"]): f"T{i + 1}" for i, r in enumerate(rows)}
        id_of = {v: k for k, v in ref_of.items()}

        relations = IssueRelation.objects.filter(
            project_id=project_id, relation_type__in=GANTT_RELATION_TYPES, deleted_at__isnull=True
        ).values("issue_id", "related_issue_id", "relation_type")
        edges = []
        for pred, succ, kind in build_edges(
            [
                {
                    "issue_id": str(r["issue_id"]),
                    "related_issue_id": str(r["related_issue_id"]),
                    "relation_type": r["relation_type"],
                }
                for r in relations
            ]
        ):
            if pred in ref_of and succ in ref_of:
                edges.append(f"{ref_of[pred]} -> {ref_of[succ]} ({kind})")

        targets = [r for r in rows if str(r["id"]) in target_ids]
        undated_count = sum(1 for r in targets if not r["start_date"] and not r["target_date"])
        # Only fires when the caller asked for "whatever has no dates". An explicit
        # selection means these items are the job, dates or no dates.
        if not explicit and not targets:
            return Response(
                {
                    "assignments": [],
                    "skipped": [],
                    "notes": "Every work item already has dates.",
                    "undated_count": 0,
                    "requested_count": 0,
                    # Undated items are selected first, so an empty set here really
                    # does mean the whole project is scheduled, cap or no cap.
                    "truncated": truncated,
                    "provider": config["provider"],
                    "model": config["model"],
                },
                status=status.HTTP_200_OK,
            )

        # Who the model may hand work to. Restricted to active project members with at
        # least MEMBER access because Plane refuses any other assignee: proposing a
        # roster entry with no Plane account would produce a plan that cannot be applied.
        candidates = _plan_candidates(project_id, _visible_projects(request, slug))
        candidate_by_ref = {c["ref"]: c for c in candidates}
        ref_by_user = {c["user_id"]: c["ref"] for c in candidates}

        # Current owners, read through IssueAssignee and never through the `assignees`
        # m2m: assignee rows are soft-deleted and the m2m join ignores the through
        # model's manager, so a removed assignee would still look like the owner.
        owners = defaultdict(list)
        for a in IssueAssignee.objects.filter(
            issue_id__in=list(ref_of.keys()), deleted_at__isnull=True
        ).values("issue_id", "assignee_id"):
            ref = ref_by_user.get(str(a["assignee_id"]))
            if ref:
                owners[str(a["issue_id"])].append(ref)

        def describe(r):
            issue_id = str(r["id"])
            ref = ref_of[issue_id]
            bits = [f'{ref}: "{r["name"][:120]}"', f"priority={r['priority']}", f"state={r['state__group']}"]
            if r["parent_id"] and str(r["parent_id"]) in ref_of:
                bits.append(f"sub-item of {ref_of[str(r['parent_id'])]}")
            if r["start_date"] or r["target_date"]:
                bits.append(f"currently scheduled {r['start_date']} -> {r['target_date']}")
            if owners.get(issue_id):
                bits.append(f"currently owned by {', '.join(sorted(owners[issue_id]))}")
            if issue_id in target_ids:
                bits.append(
                    "SELECTED - you must complete this one"
                    if explicit
                    else "NO DATES - you must schedule this one"
                )
            return " | ".join(bits)

        prompt = [
            f'Project: "{project.name}" ({project.identifier}).',
            f"Today is {timezone.now().date().isoformat()}.",
            f"Project window: {window_start or 'not set'} to {window_end or 'not set'}.",
            f"When no better signal exists, assume an item takes about {default_days} working days.",
        ]
        context = (request.data.get("context") or "").strip()
        if context:
            prompt.append(f"Extra context from the project lead: {context[:1500]}")
        prompt.append("")
        if candidates:
            prompt.append(f"Team ({len(candidates)}) - the only people you may assign work to:")
            prompt.extend(
                " | ".join(
                    [
                        f"{c['ref']}: {c['name']}",
                        f"roles: {', '.join(c['roles']) if c['roles'] else 'not recorded'}",
                        f"currently {c['assigned']} open item(s), {c['overdue']} overdue",
                    ]
                )
                for c in candidates
            )
        else:
            prompt.append(
                "Team: nobody on this project can be given work, so return assignee_ref: null "
                "for every item - and name the discipline each item needs in `role` instead, "
                "which is the answer that will actually be used."
            )
        prompt.append("")
        # Given even when the team is empty: the discipline is the part of the answer
        # that survives an instance where almost nobody has an account.
        role_vocabulary = _role_vocabulary(project_id)
        prompt.append(
            f"Disciplines ({len(role_vocabulary)}) - choose `role` from this list: "
            + ", ".join(role_vocabulary)
        )
        prompt.append("")
        prompt.append(f"Work items ({len(rows)}):")
        prompt.extend(describe(r) for r in rows)
        if edges:
            prompt.append("")
            prompt.append("Dependencies (predecessor -> successor; FS = finish-to-start, SS = start-to-start):")
            prompt.extend(edges[:200])
        prompt.append("")
        marker = "marked SELECTED" if explicit else "marked NO DATES"
        prompt.append(
            f"Return dates, a discipline and an owner ONLY for the {len(targets)} item(s) "
            f"{marker}: " + ", ".join(ref_of[str(r["id"])] for r in targets)
        )
        if explicit:
            # Say why they are in the list, so a model that sees dates already there
            # does not decide the item needs nothing and drop it from the answer.
            line = "These were chosen by hand, so plan every one of them even if it already looks scheduled."
            if undated_count < len(targets):
                line += " Where an item already has dates, replace them with your best plan for the batch as a whole."
            prompt.append(line + " Give each of them a discipline, and an owner where you can name one.")

        # The answer grows with the number of items (~60 output tokens per assignment now
        # that each carries an owner and a discipline), so a fixed budget truncates the
        # JSON — and 502s with "did not return usable JSON" — past roughly a hundred
        # items. Size it from the work being planned; len(targets) is capped by MAX_ITEMS.
        max_tokens = max(2500, min(20000, 1200 + 100 * len(targets)))
        data, error = chat_json(config, self.SYSTEM, "\n".join(prompt), max_tokens=max_tokens)
        if error:
            return Response({"error": error}, status=status.HTTP_502_BAD_GATEWAY)

        allowed = {ref_of[str(r["id"])] for r in targets}
        name_of = {str(r["id"]): r["name"] for r in rows}
        seq_of = {str(r["id"]): r["sequence_id"] for r in rows}
        proposals, skipped = [], []
        for item in data.get("assignments") or []:
            if not isinstance(item, dict):
                continue
            ref = str(item.get("ref") or "").strip()
            if ref not in allowed:
                skipped.append(ref or "?")
                continue
            start = _parse_date(item.get("start_date"))
            target = _parse_date(item.get("target_date"))
            if not start or not target or target < start:
                skipped.append(ref)
                continue
            issue_id = id_of[ref]
            # An owner the model made up is dropped rather than rejecting the whole row:
            # a good set of dates with no owner is still worth reviewing.
            owner = candidate_by_ref.get(str(item.get("assignee_ref") or "").strip())
            # The discipline is kept even when it is not one we offered - roles are free
            # text everywhere else here (see PROJECT_ROLES), and a model answering
            # "acoustics" on a project that has just hired one is right, not wrong.
            role = str(item.get("role") or "").strip()[:80] or None
            proposals.append(
                {
                    "issue_id": issue_id,
                    "name": name_of[issue_id],
                    "sequence_id": seq_of[issue_id],
                    "start_date": start.isoformat(),
                    "target_date": target.isoformat(),
                    "assignee_id": owner["user_id"] if owner else None,
                    "assignee_name": owner["name"] if owner else None,
                    "role": role,
                    "reason": str(item.get("reason") or "")[:280],
                }
            )

        notes = str(data.get("notes") or "")[:1200]
        if not candidates:
            # A silent no-op on owners would read as "the model had no opinion".
            notes = (
                "Nobody on this project can be given work yet - an owner must be an "
                "active project member with member access - so each item was given the "
                "discipline it needs instead. Those are recorded when you apply, and the "
                "work is handed over automatically as soon as somebody holding one joins "
                "the project. " + notes
            )
        if truncated:
            # Say it out loud: quietly planning a subset of a big project while
            # reporting a smaller count is how a plan goes wrong unnoticed.
            warning = (
                f"This project has more work items than one request covers, so only "
                f"{len(rows)} of them were sent to the model. "
            )
            if target_total > len(targets):
                warning += (
                    f"{len(targets)} of {target_total} item(s) were planned - "
                    "apply these, then re-run to finish the rest. "
                )
            notes = warning + notes

        return Response(
            {
                "assignments": proposals,
                "skipped": skipped,
                "notes": notes,
                # Both counts are about what was offered to the model, not what the
                # project holds — `truncated` and the notes above carry the difference.
                # `undated_count` keeps its old meaning (of these, how many had no dates)
                # so the setup flow reads the same as before.
                "undated_count": undated_count,
                "requested_count": len(targets),
                "truncated": truncated,
                "provider": config["provider"],
                "model": config["model"],
            },
            status=status.HTTP_200_OK,
        )


class ProjectApplyPlanEndpoint(BaseAPIView):
    """Write an approved set of dates - owners, and the disciplines the work needs -
    onto a project's work items.

    Deliberately dumb and explicit: it takes exactly the rows the user reviewed and
    accepted. Dates go in through a bulk .update(), same trade-off as auto-schedule -
    it skips the activity feed and webhooks, because one reflow should not generate
    eighty notifications.

    Owners are the opposite case and are noisy on purpose: an assignment nobody is told
    about is not an assignment. Each issue that gains one gets an issue_activity, which
    is what writes the feed entry, the subscriber row and the notification.

    A `roles` list on a row is the durable half of the answer: it is recorded whether or
    not anybody currently holds the discipline, and it is re-materialised at the end of
    this call - so a plan applied against a roster of two accounts is not lost work, it
    is work waiting for the person who will do it.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        from plane.bgtasks.issue_activities_task import issue_activity
        from plane.utils.host import base_host

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        rows = request.data.get("issues") or []
        if not isinstance(rows, list) or not rows:
            return Response({"error": "issues is required"}, status=status.HTTP_400_BAD_REQUEST)

        valid_ids = {
            str(i)
            for i in Issue.issue_objects.filter(
                project_id=project_id, workspace__slug=slug
            ).values_list("id", flat=True)
        }

        # Every proposed owner in the batch checked in one query, against exactly the
        # rule Plane's own issue serializer applies (active project member, role >= 15).
        # Per-row queries would mean one round trip per work item for the same answer.
        wanted_assignees, touched_ids = set(), set()
        for row in rows:
            if isinstance(row, dict):
                wanted_assignees.update(_uuid_list(row.get("assignee_ids")))
                touched_ids.update(_uuid_list([row.get("issue_id")]))
        allowed_assignees = (
            _assignable_member_ids(project_id, wanted_assignees) if wanted_assignees else set()
        )
        assignees_rejected = sorted(wanted_assignees - allowed_assignees)

        # The owners the reviewed items already have, so the write below only adds what
        # is missing. Read through IssueAssignee (never the `assignees` m2m): assignee
        # rows are soft-deleted and a m2m join does not apply the through model's manager.
        current = defaultdict(set)
        if touched_ids:
            for a in IssueAssignee.objects.filter(
                issue__project_id=project_id, issue_id__in=list(touched_ids), deleted_at__isnull=True
            ).values("issue_id", "assignee_id"):
                current[str(a["issue_id"])].add(str(a["assignee_id"]))

        applied, rejected = 0, []
        new_links, gained = [], {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            issue_id = str(row.get("issue_id") or "")
            if issue_id not in valid_ids:
                rejected.append(issue_id or "?")
                continue
            start = _parse_date(row.get("start_date"))
            target = _parse_date(row.get("target_date"))
            row_assignees = _uuid_list(row.get("assignee_ids"))
            if start and target and target >= start:
                Issue.objects.filter(id=issue_id).update(start_date=start, target_date=target)
                applied += 1
            elif row.get("start_date") or row.get("target_date") or not row_assignees:
                # Dates were offered but unusable (or the row says nothing at all).
                # Report it, and still honour the owners - they are an independent fact.
                rejected.append(issue_id)

            to_add = {a for a in row_assignees if a in allowed_assignees}
            to_add -= current[issue_id]
            if not to_add:
                continue
            # Add, never replace: a human may already have picked an owner, and this
            # action is called "complete", not "overwrite".
            gained[issue_id] = to_add
            for assignee_id in sorted(to_add):
                # bulk_create bypasses save(), so the denormalised project/workspace
                # columns and the audit user have to be set here or the rows land with
                # NULLs — same construction as IssueSerializer.create upstream.
                new_links.append(
                    IssueAssignee(
                        issue_id=issue_id,
                        assignee_id=assignee_id,
                        project_id=project_id,
                        workspace_id=project.workspace_id,
                        created_by_id=request.user.id,
                    )
                )

        # The disciplines each reviewed item needs. Recorded before the owners are
        # materialised below, so an item whose role does have a holder gets pointed at
        # them in the same call the user clicked Apply in.
        existing_roles = defaultdict(set)
        if touched_ids:
            for issue_id, role in IssueRole.objects.filter(
                issue__project_id=project_id, issue_id__in=list(touched_ids)
            ).values_list("issue_id", "role"):
                existing_roles[str(issue_id)].add(role.strip().lower())
        new_roles, roles_set = [], set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            issue_id = str(row.get("issue_id") or "")
            if issue_id not in valid_ids:
                continue
            roles = _clean_roles(row.get("roles"))
            if not roles:
                continue
            roles_set.add(issue_id)
            # Provenance, not policy: both kinds of row arrive through this endpoint
            # (the assistant's proposal, and whatever the reviewer typed over it), and
            # only the caller knows which is which.
            source = IssueRole.AI if str(row.get("source") or "ai") == "ai" else IssueRole.MANUAL
            for role in roles:
                if role.lower() in existing_roles[issue_id]:
                    continue
                new_roles.append(IssueRole(issue_id=issue_id, role=role, source=source))
        if new_roles:
            # Same race as the assignee write below: two reviewers applying overlapping
            # plans must not turn into a 500 on the unique index.
            IssueRole.objects.bulk_create(new_roles, batch_size=100, ignore_conflicts=True)

        if new_links:
            # ignore_conflicts covers the race with someone assigning by hand in the UI
            # between the read above and this write.
            IssueAssignee.objects.bulk_create(new_links, batch_size=100, ignore_conflicts=True)

        for issue_id, added in gained.items():
            # Writing IssueAssignee rows notifies nobody on its own; track_assignees
            # inside this task is what creates the activity, subscribes the new owner
            # and sends the notification. Dates keep their deliberate silence above.
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"assignee_ids": sorted(current[issue_id] | added)}),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=json.dumps({"assignee_ids": sorted(current[issue_id])}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

        # Runs after both writes, so it reads the owners just added and only fires for an
        # item whose discipline points somewhere the explicit owner did not. On the usual
        # plan the model names the same person twice and this is a no-op.
        repointed = _materialise_issue_roles(
            project,
            request.user.id,
            issue_ids=roles_set,
            origin=base_host(request=request, is_app=True),
        )

        return Response(
            {
                "applied": applied,
                "rejected": rejected,
                # Issues that gained at least one owner, and the proposed owners this
                # project would not accept — an empty screen deserves an explanation.
                # The two writes can touch the same item, so the union, not the sum.
                "assigned": len(set(gained.keys()) | repointed),
                "assignees_rejected": assignees_rejected,
                # Issues that now carry a discipline. Deliberately independent of
                # `assigned`: recording one when nobody holds it is the expected
                # outcome here, not a half-failure.
                "roles_set": len(roles_set),
            },
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Project setup: from an empty project to a dated, owned, sprint-cut plan
# ---------------------------------------------------------------------------


def _capacity_from_roster(project_id):
    """{discipline: how many people hold it} — the default width of each track.

    Counts the roster, not Plane accounts: two firmware engineers who have never
    signed in still mean firmware work can run two-abreast, and that is the fact the
    schedule needs. Whether either of them can be *assigned* is a different question,
    answered by _role_holders.
    """
    counts = defaultdict(int)
    for roles in ProjectTeamMember.objects.filter(project_id=project_id).values_list("roles", flat=True):
        for role in _clean_roles(roles):
            counts[role.strip().lower()] += 1
    return dict(counts)


def _schedulable_people(project_id):
    """The roster entries Plane will accept as an assignee, with what each covers.

    The planner schedules against these rather than against disciplines, because a
    person holding two disciplines is one pair of hands: their tasks have to queue,
    not run side by side. Anyone without a usable Plane account is left out — they
    cannot be given a work item, so pretending they are available would produce a
    plan that shortens on paper and not in life.
    """
    rows = list(ProjectTeamMember.objects.filter(project_id=project_id))
    linked = [str(r.member_id) for r in rows if r.member_id]
    assignable = _assignable_member_ids(project_id, linked) if linked else set()
    if not assignable:
        return []

    names = {
        str(u.id): (u.display_name or u.first_name or u.email)
        for u in User.objects.filter(id__in=list(assignable))
    }
    people, seen = [], set()
    # Leads first, then by name — a stable order, so an equal-first tie in the
    # scheduler always resolves the same way between two runs.
    for row in sorted(rows, key=lambda r: (not r.is_lead, (r.name or "").lower())):
        user_id = str(row.member_id) if row.member_id else None
        if not user_id or user_id not in assignable or user_id in seen:
            continue
        seen.add(user_id)
        people.append(
            {
                "id": user_id,
                "name": names.get(user_id) or row.name,
                "roles": [r.strip().lower() for r in _clean_roles(row.roles)],
                # How much of a week this person gives the project, and when they
                # are away. The scheduler assumed five days and no absences for
                # everyone, which is how a plan around a three-day-a-week engineer
                # came out nearly twice as fast as it runs.
                "days_per_week": row.days_per_week,
                "leave": row.leave or [],
            }
        )
    return people


class ProjectBlueprintEndpoint(BaseAPIView):
    """The generic task catalogue the setup wizard ticks through.

    Served rather than duplicated in the frontend so the two cannot drift: the same
    list is what the planner schedules and what apply writes.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        from .blueprints import agile_catalogue, catalogue

        # Both shapes in one answer: the V for a project run as a continuous flow,
        # the iteration blocks for one run in sprints. Which the wizard shows follows
        # from the cadence the lead picks, and it asks that before the tasks.
        return Response({**catalogue(), "agile": agile_catalogue()}, status=status.HTTP_200_OK)


class ProjectSetupPlanEndpoint(BaseAPIView):
    """Turn the wizard's answers into a dated, owned, sprint-cut plan. Writes nothing.

    The split matters: **dates are computed here, never by the model**. A deterministic
    pass walks the dependency graph in topological order, counts in working days, and
    lets each discipline run as many tasks side by side as it has people — which is why
    the proposed end date moves when the lead says they have two firmware engineers
    rather than one. Ask a language model for eighty consistent dates and some of them
    will be wrong; nobody will notice which.

    The model, when one is configured, is asked the question it is actually good at:
    what does *this* project need that the generic list misses, and are these durations
    plausible. Its answer feeds back through the same scheduler.
    """

    SYSTEM = (
        "You are an engineering project manager for a conservation-technology team that "
        "builds wildlife tracking devices (GPS/satellite tags, cameras, sensors). You are "
        "given a project and the generic V-cycle task list chosen for it. Your job is to "
        "adapt it: adjust durations that are clearly wrong for this project, and add the "
        "tasks this specific project needs that a generic list cannot know about. "
        "Rules: never remove a task; never renumber or rename an existing key; keep added "
        "tasks few (at most 8) and concrete; every added task must name a role from the "
        "Disciplines list and may only depend on keys that exist. Durations are working "
        "days, between 1 and 120. "
        "Reply with JSON only, no prose, in exactly this shape: "
        '{"durations":{"hw.layout":12},"extra":[{"key":"hw.antenna","name":"Antenna tuning '
        'and range test","track":"hardware","phase":"verification","role":"hardware engineer",'
        '"days":5,"after":["hw.bringup"]}],"notes":"one short paragraph"}'
    )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        from .blueprints import (
            TASK_BY_KEY,
            assign_sprints,
            build_agile_tasks,
            build_tasks,
            compute_float,
            default_selection,
            schedule,
            split_into_sprints,
            sprints_from_agile_keys,
        )

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        tracks = [str(t).strip() for t in (request.data.get("tracks") or []) if str(t).strip()]
        raw_keys = request.data.get("task_keys")
        keys = (
            [str(k).strip() for k in raw_keys if str(k).strip() in TASK_BY_KEY]
            if isinstance(raw_keys, list)
            else default_selection(tracks)
        )
        if not keys:
            return Response(
                {"error": "Pick at least one component, or one task."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule_row = ProjectSchedule.objects.filter(project_id=project_id).first()
        start = (
            _parse_date(request.data.get("start_date"))
            or (schedule_row.start_date if schedule_row else None)
            or timezone.now().date()
        )

        def _positive(value, ceiling):
            try:
                return max(1, min(ceiling, int(value)))
            except (TypeError, ValueError):
                return None

        field_days = _positive(request.data.get("field_days"), 365)
        production_days = _positive(request.data.get("production_days"), 365)

        overrides = {}
        for key, value in (request.data.get("duration_overrides") or {}).items():
            days = _positive(value, 365)
            if days and str(key) in TASK_BY_KEY:
                overrides[str(key)] = days

        # {task key: discipline}. The lead moving a task off a discipline nobody holds
        # — take "reviewer" off the roster and the review tasks can be handed to the
        # hardware engineer instead of falling back to one anonymous pair of hands.
        # Not filtered against TASK_BY_KEY on purpose: the builders only apply an
        # override to a key they actually emit, and that covers model-proposed tasks
        # and the agile blocks too, neither of which is in the V-cycle catalogue.
        role_overrides = {}
        for key, value in (request.data.get("role_overrides") or {}).items():
            role = str(value or "").strip()[:80]
            if role:
                role_overrides[str(key)] = role

        # Roster width first, then whatever the lead typed over it. Only consulted for
        # disciplines nobody on the roster covers — where somebody is named, the
        # scheduler counts that person's calendar instead.
        capacity = _capacity_from_roster(project_id)
        for role, value in (request.data.get("capacity") or {}).items():
            seats = _positive(value, 50)
            if seats:
                capacity[str(role).strip().lower()] = seats

        # Dates a human typed on the review table, and dependencies they redrew.
        # Both outrank the generated plan; everything else reflows around them.
        pinned_dates = {}
        for key, value in (request.data.get("fixed_dates") or {}).items():
            if not isinstance(value, dict):
                continue
            begins = _parse_date(value.get("start_date"))
            ends = _parse_date(value.get("target_date"))
            if begins and ends and ends >= begins:
                pinned_dates[str(key)] = (begins, ends)

        dependency_overrides = {}
        for key, value in (request.data.get("dependencies") or {}).items():
            if isinstance(value, list):
                dependency_overrides[str(key)] = [str(v) for v in value if v][:20]

        people = _schedulable_people(project_id)
        pinnable = {p["id"] for p in people}
        # Optional, per task: the lead naming who does this one instead of leaving it
        # to whoever holds the discipline. Anyone Plane would refuse is dropped here
        # rather than producing a plan that cannot be applied.
        pinned = {}
        for key, value in (request.data.get("assignees") or {}).items():
            user_id = str(value).strip() if value else ""
            if user_id in pinnable:
                pinned[str(key)] = user_id

        notes, provider, model_name = "", None, None
        extra, ai_durations = [], {}
        # Tasks the model added on an earlier pass, handed back so re-planning after a
        # change of owner does not spend another model call — or, worse, quietly
        # produce a different set of tasks than the one on screen.
        carried = [e for e in (request.data.get("extra_tasks") or []) if isinstance(e, dict)][:12]
        if carried:
            extra = carried
        elif request.data.get("use_ai"):
            from .ai import chat_json, resolve_config

            config = resolve_config(project.workspace_id)
            if config:
                provider, model_name = config["provider"], config["model"]
                vocabulary = _role_vocabulary(project_id)
                context = (request.data.get("context") or "").strip()[:1500]
                prompt = [
                    f'Project: "{project.name}" ({project.identifier}).',
                    f"Components: {', '.join(tracks) or 'not stated'}.",
                    f"Starts {start.isoformat()}.",
                ]
                if field_days:
                    prompt.append(f"A field mission of about {field_days} working days is planned.")
                if production_days:
                    prompt.append(f"A production run of about {production_days} working days is planned.")
                if context:
                    prompt.append(f"Extra context from the project lead: {context}")
                prompt.append("")
                prompt.append(f"Disciplines available: {', '.join(vocabulary)}")
                prompt.append("")
                prompt.append(f"Chosen tasks ({len(keys)}) — key | name | role | days:")
                prompt.extend(
                    f"{k} | {TASK_BY_KEY[k]['name']} | {TASK_BY_KEY[k]['role']} | "
                    f"{overrides.get(k, TASK_BY_KEY[k]['days'])}"
                    for k in keys
                )
                data, error = chat_json(config, self.SYSTEM, "\n".join(prompt), max_tokens=3000)
                if error:
                    # A plan without the model is still a plan — say so and carry on
                    # rather than failing the whole step.
                    notes = f"The assistant could not be reached ({error}); this is the generic plan."
                else:
                    for key, value in (data.get("durations") or {}).items():
                        days = _positive(value, 120)
                        if days and str(key) in TASK_BY_KEY:
                            ai_durations[str(key)] = days
                    extra = [e for e in (data.get("extra") or []) if isinstance(e, dict)][:8]
                    notes = str(data.get("notes") or "")[:1200]

        # The lead's own overrides outrank the model's.
        merged = {**ai_durations, **overrides}
        sprint_cfg = request.data.get("sprints") or {}
        in_sprints = str(sprint_cfg.get("mode") or "flow") == "sprints"
        sprint_length = _positive(sprint_cfg.get("length_days"), 90) or 14
        sprint_count = _positive(sprint_cfg.get("count"), 52)

        if in_sprints and str(request.data.get("method") or "agile") == "agile":
            # Sprints are not a way of slicing a V — they are a different shape of
            # work. An iteration plans, builds, tests and shows an increment, and the
            # next one starts from what that taught you.
            ceremonies = request.data.get("ceremonies")
            tasks = build_agile_tasks(
                tracks,
                sprint_count=sprint_count or 6,
                # A fortnight is ten working days; the ceremonies take their share of
                # it and the increment gets the rest.
                sprint_working_days=max(2, round(sprint_length * 5 / 7)),
                ceremonies=ceremonies if isinstance(ceremonies, list) else None,
                duration_overrides=merged,
                role_overrides=role_overrides,
                assignees=pinned,
                extra=extra,
                dependency_overrides=dependency_overrides,
            )
        else:
            tasks = build_tasks(
                keys,
                field_days=field_days,
                production_days=production_days,
                duration_overrides=merged,
                role_overrides=role_overrides,
                extra=extra,
                assignees=pinned,
                dependency_overrides=dependency_overrides,
            )
        # The plan is only as honest as the calendar it is built on: holidays,
        # part-time weeks and booked leave all move the end date, and none of them
        # were known to the scheduler before.
        placed, warnings = schedule(tasks, start, capacity, people, pinned_dates, _holidays_for(slug))
        end = max((v["target"] for v in placed.values()), default=start)

        # How much each task can slip. Derived from the dates that were just placed,
        # so it can never disagree with them — which a separate critical-path
        # endpoint computed from the database eventually would.
        slack = compute_float(tasks, placed, end)

        sprints = []
        sprint_of = {}
        if in_sprints:
            # Agile blocks carry their sprint in the key, so read it rather than
            # re-derive it from dates: the calendar split turned six sprints into
            # twenty cycles the moment contention stretched an increment.
            agile_membership, agile_sprints = sprints_from_agile_keys(placed)
            if agile_membership:
                sprint_of, sprints = agile_membership, agile_sprints
            else:
                # Continuous-flow work has no block structure to read, so the
                # fixed-length split is still the only available answer there.
                sprints = split_into_sprints(start, end, length_days=sprint_length, count=sprint_count)
                sprint_of = assign_sprints(placed, sprints)

        # Owners now come out of the schedule itself — it is what decided which of
        # several holders each task went to, and it is the only thing that knows
        # somebody covering two disciplines could not be in both places at once.
        names = {p["id"]: p["name"] for p in people}
        counts = _capacity_from_roster(project_id)
        missing = sorted(
            {
                t["role"]
                for t in tasks
                if t.get("role") and not counts.get(t["role"].strip().lower())
            }
        )

        rows = []
        for task in tasks:
            dates = placed[task["key"]]
            owner = dates.get("assignee_id")
            rows.append(
                {
                    **task,
                    "start_date": dates["start"].isoformat(),
                    "target_date": dates["target"].isoformat(),
                    "assignee_id": owner,
                    "assignee_name": names.get(owner) if owner else None,
                    "pinned": task["key"] in pinned,
                    "date_pinned": task["key"] in pinned_dates,
                    "sprint": sprint_of.get(task["key"]),
                    # Working days of slack. `free` moves nothing else; `total` holds
                    # the delivery date but shifts what comes after. Zero total float
                    # is the definition of the critical path.
                    "free_float": slack.get(task["key"], {}).get("free"),
                    "total_float": slack.get(task["key"], {}).get("total"),
                    "critical": slack.get(task["key"], {}).get("critical", False),
                }
            )
        rows.sort(key=lambda r: (r["start_date"], r["target_date"], r["key"]))

        return Response(
            {
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "tasks": rows,
                "sprints": [
                    {
                        "index": s["index"],
                        "name": s["name"],
                        "start_date": s["start"].isoformat(),
                        "end_date": s["end"].isoformat(),
                        "task_count": sum(1 for k in sprint_of.values() if k == s["index"]),
                    }
                    for s in sprints
                ],
                # The chain with no slack at all: lose a day on any of these and the
                # end date moves. Sent as a count so the plan step can say it in one
                # line rather than making the lead scan a column.
                "critical_count": sum(1 for v in slack.values() if v.get("critical")),
                "capacity": capacity,
                "role_counts": counts,
                # Who the lead may name on a task. Sent back so the review table can
                # offer exactly the people Plane would accept, and no one else.
                "people": people,
                # The disciplines this plan needs and nobody on the roster holds. Not an
                # error: the requirement is recorded on the item either way, and the work
                # is handed over the day somebody picks the discipline up.
                "missing_roles": missing,
                "warnings": warnings,
                "notes": notes,
                "provider": provider,
                "model": model_name,
            },
            status=status.HTTP_200_OK,
        )


class ProjectAiDraftEndpoint(BaseAPIView):
    """Fill in a work item from the one line somebody typed into the title box.

    Creating a task by hand means writing a title, then a description, then guessing
    a duration, then picking a discipline, then finding whoever covers it — and most
    people stop after the title. This answers the rest from the title plus what the
    project already knows: its window, the disciplines its roster holds, and how the
    existing items are written.

    It proposes. Nothing is written, and every field lands in a form the person can
    still edit before saving — which is the only reason it is safe to be wrong.
    """

    SYSTEM = (
        "You help an engineer finish writing a work item for a conservation-technology "
        "team that builds wildlife tracking devices (GPS/satellite tags, cameras, "
        "sensors). Given a short title, write the item out. Rules: the description is "
        "two or three sentences of plain HTML (<p> only) saying what has to be done and "
        "what done looks like — no headings, no lists, no restating the title. Estimate "
        "the working days honestly; most items are 1 to 10. Choose the discipline from "
        "the Disciplines list you are given, and only from it. Reply with JSON only, no "
        "prose, in exactly this shape: "
        '{"description_html":"<p>...</p>","role":"embedded firmware","days":5,'
        '"reason":"one short sentence"}'
    )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        from .ai import chat_json, resolve_config
        from .blueprints import add_working_days, next_working_day

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        title = (request.data.get("title") or "").strip()
        if len(title) < 3:
            return Response(
                {"error": "Give the item a title first — that is what this works from."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        config = resolve_config(project.workspace_id)
        if not config:
            return Response(
                {"error": "No AI provider is configured for this workspace."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        vocabulary = _role_vocabulary(project_id)
        schedule = ProjectSchedule.objects.filter(project_id=project_id).first()

        # A handful of existing titles so the draft matches how this project writes,
        # rather than how a language model writes. Cheap, and it is what makes the
        # output feel like it belongs.
        samples = list(
            Issue.issue_objects.filter(project_id=project_id)
            .order_by("-created_at")
            .values_list("name", flat=True)[:8]
        )

        prompt = [
            f'Project: "{project.name}" ({project.identifier}).',
            f"Title the engineer typed: {title[:300]}",
        ]
        context = (request.data.get("context") or "").strip()
        if context:
            prompt.append(f"Extra context: {context[:1000]}")
        if schedule and (schedule.start_date or schedule.target_date):
            prompt.append(f"Project window: {schedule.start_date} to {schedule.target_date}.")
        if samples:
            prompt.append("")
            prompt.append("How work items are named on this project:")
            prompt.extend(f"- {name[:120]}" for name in samples)
        prompt.append("")
        prompt.append(f"Disciplines — choose `role` from this list: {', '.join(vocabulary)}")

        data, error = chat_json(config, self.SYSTEM, "\n".join(prompt), max_tokens=900)
        if error:
            return Response({"error": error}, status=status.HTTP_502_BAD_GATEWAY)

        try:
            days = max(1, min(120, int(data.get("days") or 5)))
        except (TypeError, ValueError):
            days = 5

        # Dates are computed, not asked for — the same rule as the planner. The model
        # estimates an effort; turning that into a window is arithmetic.
        start = next_working_day(timezone.now().date())
        if schedule and schedule.start_date and schedule.start_date > start:
            start = next_working_day(schedule.start_date)
        target = add_working_days(start, days)

        role = str(data.get("role") or "").strip()[:80] or None
        # Whoever holds the discipline, if anyone does. Same resolution the planner
        # uses, so a draft and a plan never disagree about who owns what.
        owner = _role_holders(project_id).get(role.lower()) if role else None
        owner_name = None
        if owner:
            user = User.objects.filter(id=owner).first()
            owner_name = (user.display_name or user.first_name or user.email) if user else None

        description = str(data.get("description_html") or "").strip()[:4000]
        return Response(
            {
                "description_html": description or None,
                "role": role,
                "days": days,
                "start_date": start.isoformat(),
                "target_date": target.isoformat(),
                "assignee_id": owner,
                "assignee_name": owner_name,
                "reason": str(data.get("reason") or "")[:280],
                "provider": config["provider"],
                "model": config["model"],
            },
            status=status.HTTP_200_OK,
        )


class ProjectCleanEndpoint(BaseAPIView):
    """Empty a project, one category at a time.

    Setting a project up is now a five-minute job, which makes getting it wrong
    cheap — but only if starting over is cheap too. Without this, a lead who ran the
    wizard with the wrong components had forty work items to delete by hand.

    Work items, cycles and modules are **soft**-deleted the way Plane's own delete
    does, so a mistake is recoverable from the database rather than gone. The
    fork's own rows (disciplines, the roster, the baseline, the schedule) have no
    soft-delete and are removed outright — they are small and re-derivable.

    Nothing happens without `confirm` matching the project identifier: a modal that
    deletes on a single click is one people delete a project with.
    """

    CATEGORIES = ["work_items", "cycles", "modules", "roles", "team", "schedule", "links"]

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="PROJECT")
    def post(self, request, slug, project_id):
        from plane.db.models import Cycle, CycleIssue, Module, ModuleIssue

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        confirm = str(request.data.get("confirm") or "").strip()
        if confirm.upper() != (project.identifier or "").upper():
            return Response(
                {"error": f"Type the project identifier ({project.identifier}) to confirm."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        wanted = {c for c in self.CATEGORIES if request.data.get(c)}
        if not wanted:
            return Response({"error": "Nothing selected."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        removed = {}
        with transaction.atomic():
            if "work_items" in wanted:
                issue_ids = list(
                    Issue.issue_objects.filter(project_id=project_id).values_list("id", flat=True)
                )
                # The links first: a soft-deleted issue still has hard rows pointing at
                # it, and a dangling relation would draw an arrow to nothing on the gantt.
                IssueRelation.objects.filter(
                    Q(issue_id__in=issue_ids) | Q(related_issue_id__in=issue_ids)
                ).delete()
                IssueAssignee.objects.filter(issue_id__in=issue_ids).delete()
                IssueRole.objects.filter(issue_id__in=issue_ids).delete()
                CycleIssue.objects.filter(issue_id__in=issue_ids).delete()
                ModuleIssue.objects.filter(issue_id__in=issue_ids).delete()
                IssueBaseline.objects.filter(issue_id__in=issue_ids).delete()
                removed["work_items"] = Issue.objects.filter(id__in=issue_ids).update(deleted_at=now)
            else:
                # Cleaning cycles or modules without cleaning the work items must not
                # leave the items pointing at something that no longer exists.
                if "cycles" in wanted:
                    CycleIssue.objects.filter(project_id=project_id).delete()
                if "modules" in wanted:
                    ModuleIssue.objects.filter(project_id=project_id).delete()
                if "roles" in wanted:
                    removed["roles"] = IssueRole.objects.filter(issue__project_id=project_id).delete()[0]

            if "cycles" in wanted:
                removed["cycles"] = Cycle.objects.filter(project_id=project_id, deleted_at__isnull=True).update(
                    deleted_at=now
                )
            if "modules" in wanted:
                removed["modules"] = Module.objects.filter(project_id=project_id, deleted_at__isnull=True).update(
                    deleted_at=now
                )
            if "roles" in wanted and "roles" not in removed:
                removed["roles"] = IssueRole.objects.filter(issue__project_id=project_id).delete()[0]
            if "team" in wanted:
                removed["team"] = ProjectTeamMember.objects.filter(project_id=project_id).delete()[0]
            if "schedule" in wanted:
                removed["schedule"] = ProjectSchedule.objects.filter(project_id=project_id).delete()[0]
            if "links" in wanted:
                removed["links"] = ProjectWikiDoc.objects.filter(project_id=project_id).delete()[0]

        return Response({"removed": removed}, status=status.HTTP_200_OK)


class ProjectSetupApplyEndpoint(BaseAPIView):
    """Write an approved plan into the project: work items, dependencies, disciplines,
    owners, modules per component and cycles per sprint.

    Re-runnable on purpose. A task whose name already exists in the project is skipped
    rather than duplicated, so a double click — or a lead running the wizard again after
    adding a track — extends the plan instead of doubling it.

    Owners are not written directly: the discipline goes on the item and
    _materialise_issue_roles resolves it, which is also what fires the activity, the
    subscription and the notification. An assignment nobody is told about is not one.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        from plane.bgtasks.issue_activities_task import issue_activity
        from plane.db.models import Cycle, CycleIssue, Module, ModuleIssue
        from plane.utils.host import base_host

        from .blueprints import TRACKS

        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        rows = [r for r in (request.data.get("tasks") or []) if isinstance(r, dict)]
        if not rows:
            return Response({"error": "Nothing to apply."}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > 400:
            return Response(
                {"error": "That is more work items than one plan should create at once."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        state = (
            State.objects.filter(project_id=project_id, default=True).first()
            or State.objects.filter(project_id=project_id, group="backlog").order_by("sequence").first()
            or State.objects.filter(project_id=project_id).order_by("sequence").first()
        )
        if not state:
            return Response(
                {"error": "This project has no states to create work items in."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = {
            name.strip().lower()
            for name in Issue.issue_objects.filter(project_id=project_id).values_list("name", flat=True)
        }
        track_labels = {t["key"]: t["label"] for t in TRACKS}
        track_labels["pm"] = "Project management"

        assignable_ids = _assignable_member_ids(project_id)
        created, skipped = {}, []
        issue_track, issue_role, issue_sprint, issue_owner = {}, {}, {}, {}
        with transaction.atomic():
            for row in rows:
                name = str(row.get("name") or "").strip()[:255]
                key = str(row.get("key") or "").strip()[:60]
                if not name or not key:
                    continue
                if name.lower() in existing:
                    skipped.append(name)
                    continue
                existing.add(name.lower())
                issue = Issue.objects.create(
                    name=name,
                    state=state,
                    start_date=_parse_date(row.get("start_date")),
                    target_date=_parse_date(row.get("target_date")),
                    project=project,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                )
                created[key] = issue
                issue_track[key] = str(row.get("track") or "pm")
                role = str(row.get("role") or "").strip()[:80]
                if role:
                    issue_role[key] = role
                # The plan already worked out who does this one — honouring it here is
                # what makes naming somebody in the wizard mean anything. Anyone Plane
                # would refuse is dropped, and the discipline still carries the item.
                owner = str(row.get("assignee_id") or "").strip()
                if owner in assignable_ids:
                    issue_owner[key] = owner
                sprint = row.get("sprint")
                if isinstance(sprint, int):
                    issue_sprint[key] = sprint

            # Dependencies. blocked_by reads (issue = the one that waits,
            # related_issue = the one it waits on) — see _EDGE in scheduling.py.
            links = []
            for row in rows:
                key = str(row.get("key") or "").strip()
                successor = created.get(key)
                if not successor:
                    continue
                for pred_key in row.get("after") or []:
                    predecessor = created.get(str(pred_key))
                    if predecessor and predecessor.id != successor.id:
                        links.append(
                            IssueRelation(
                                issue=successor,
                                related_issue=predecessor,
                                relation_type="blocked_by",
                                project=project,
                                workspace_id=project.workspace_id,
                                created_by=request.user,
                            )
                        )
            if links:
                IssueRelation.objects.bulk_create(links, batch_size=100, ignore_conflicts=True)

            if issue_role:
                IssueRole.objects.bulk_create(
                    [
                        IssueRole(issue_id=created[key].id, role=role, source=IssueRole.AI)
                        for key, role in issue_role.items()
                    ],
                    batch_size=100,
                    ignore_conflicts=True,
                )

            # One module per component, so the Overview's progress bars line up with the
            # way the work was actually chosen.
            modules_created = 0
            if request.data.get("create_modules") and created:
                by_track = defaultdict(list)
                for key, issue in created.items():
                    by_track[issue_track.get(key, "pm")].append(issue)
                for track, issues in by_track.items():
                    label = track_labels.get(track, track.title())
                    module = Module.objects.filter(project_id=project_id, name=label).first()
                    if not module:
                        starts = [i.start_date for i in issues if i.start_date]
                        targets = [i.target_date for i in issues if i.target_date]
                        module = Module.objects.create(
                            name=label,
                            project=project,
                            workspace_id=project.workspace_id,
                            start_date=min(starts) if starts else None,
                            target_date=max(targets) if targets else None,
                            created_by=request.user,
                        )
                        modules_created += 1
                    ModuleIssue.objects.bulk_create(
                        [
                            ModuleIssue(
                                module=module,
                                issue=issue,
                                project=project,
                                workspace_id=project.workspace_id,
                                created_by=request.user,
                            )
                            for issue in issues
                        ],
                        batch_size=100,
                        ignore_conflicts=True,
                    )

            cycles_created = 0
            sprint_rows = [s for s in (request.data.get("sprints") or []) if isinstance(s, dict)][:52]
            if sprint_rows and issue_sprint:
                cycle_by_index = {}
                for sprint in sprint_rows:
                    index = sprint.get("index")
                    start = _parse_date(sprint.get("start_date"))
                    end = _parse_date(sprint.get("end_date"))
                    if not isinstance(index, int) or not start or not end:
                        continue
                    name = str(sprint.get("name") or f"Sprint {index}").strip()[:255]
                    cycle = Cycle.objects.filter(project_id=project_id, name=name).first()
                    if not cycle:
                        # Cycle stores datetimes where everything else here stores dates;
                        # naive values would land as a warning and a wrong day near midnight.
                        cycle = Cycle.objects.create(
                            name=name,
                            project=project,
                            workspace_id=project.workspace_id,
                            owned_by=request.user,
                            start_date=timezone.make_aware(datetime.combine(start, time.min)),
                            end_date=timezone.make_aware(datetime.combine(end, time.max)),
                            created_by=request.user,
                        )
                        cycles_created += 1
                    cycle_by_index[index] = cycle
                CycleIssue.objects.bulk_create(
                    [
                        CycleIssue(
                            cycle=cycle_by_index[index],
                            issue=created[key],
                            project=project,
                            workspace_id=project.workspace_id,
                            created_by=request.user,
                        )
                        for key, index in issue_sprint.items()
                        if index in cycle_by_index and key in created
                    ],
                    batch_size=100,
                    ignore_conflicts=True,
                )

            if issue_owner:
                IssueAssignee.objects.bulk_create(
                    [
                        # bulk_create bypasses save(), so the denormalised columns have
                        # to be set here or the rows land with NULLs.
                        IssueAssignee(
                            issue_id=created[key].id,
                            assignee_id=owner,
                            project_id=project.id,
                            workspace_id=project.workspace_id,
                            created_by_id=request.user.id,
                        )
                        for key, owner in issue_owner.items()
                        if key in created
                    ],
                    batch_size=100,
                    ignore_conflicts=True,
                )

            # The window the gantt and the Overview draw against.
            if request.data.get("set_project_window") and created:
                starts = [i.start_date for i in created.values() if i.start_date]
                targets = [i.target_date for i in created.values() if i.target_date]
                if starts and targets:
                    ProjectSchedule.objects.update_or_create(
                        project_id=project_id,
                        defaults={"start_date": min(starts), "target_date": max(targets)},
                    )

        # Writing the assignee row notifies nobody on its own — this is what creates
        # the activity, subscribes the new owner and sends the mail. Outside the
        # transaction, because a slow mail server must not hold a lock over the plan.
        origin = base_host(request=request, is_app=True)
        for key, owner in issue_owner.items():
            if key not in created:
                continue
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"assignee_ids": [owner]}),
                actor_id=str(request.user.id),
                issue_id=str(created[key].id),
                project_id=str(project.id),
                current_instance=json.dumps({"assignee_ids": []}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=origin,
            )

        # Anything the plan could not name an owner for is still carrying its
        # discipline; this hands those over to whoever holds it.
        by_role = _materialise_issue_roles(
            project,
            request.user.id,
            issue_ids=[i.id for i in created.values()],
            origin=origin,
        )
        # One number for "got an owner", however they got one.
        assigned = len({str(created[k].id) for k in issue_owner if k in created} | by_role)

        return Response(
            {
                "created": len(created),
                "skipped": skipped,
                "relations": len(links),
                "roles_set": len(issue_role),
                "assigned": assigned,
                "modules_created": modules_created,
                "cycles_created": cycles_created,
            },
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Cost: what a plan is worth in money, not only in days
# ---------------------------------------------------------------------------


def _holidays_for(slug):
    """Dates nobody in this workspace works. Read once per plan, not per task."""
    return {
        row.date
        for row in WorkspaceNonWorkingDay.objects.filter(workspace__slug=slug).only("date")
    }


def _rate_map(slug):
    """{discipline: {hourly, hours_per_day, currency}} for a workspace."""
    return {
        row.role.strip().lower(): {
            "hourly_rate": float(row.hourly_rate),
            "hours_per_day": float(row.hours_per_day) or 7.0,
            "currency": row.currency,
        }
        for row in WorkspaceRoleRate.objects.filter(workspace__slug=slug)
    }


def _labour_cost(tasks, rates):
    """Cost of the human time in a task list, grouped by discipline.

    Days x hours-per-day x hourly rate. Deliberately from the *plan* rather than
    from anything recorded afterwards: this is an estimate, and the honest thing
    is that it moves whenever the plan moves.

    Currencies are kept apart rather than summed. A subcontractor billed in
    dollars beside a salaried engineer costed in euros has no meaningful total,
    and inventing one would be worse than showing two numbers.
    """
    by_role = {}
    for task in tasks:
        role = (task.get("role") or "").strip().lower()
        if not role:
            continue
        rate = rates.get(role)
        days = max(1, int(task.get("days") or 1))
        entry = by_role.setdefault(
            role,
            {"role": role, "days": 0, "hours": 0.0, "cost": 0.0, "currency": None, "rated": False},
        )
        entry["days"] += days
        if not rate:
            # No rate recorded: the days still count, so the gap is visible rather
            # than the discipline silently vanishing from the estimate.
            continue
        hours = days * rate["hours_per_day"]
        entry["hours"] += hours
        entry["cost"] += hours * rate["hourly_rate"]
        entry["currency"] = rate["currency"]
        entry["rated"] = True

    rows = sorted(by_role.values(), key=lambda r: (-r["cost"], r["role"]))
    totals = {}
    for row in rows:
        if not row["rated"]:
            continue
        totals[row["currency"]] = totals.get(row["currency"], 0.0) + row["cost"]
    return {
        "by_role": rows,
        "totals": [{"currency": c, "amount": round(v, 2)} for c, v in sorted(totals.items())],
        "unrated_roles": sorted(r["role"] for r in rows if not r["rated"]),
    }


class WorkspaceCalendarEndpoint(BaseAPIView):
    """The days nobody works. Workspace-wide: a holiday is a fact about the
    calendar, not about a project."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        rows = WorkspaceNonWorkingDay.objects.filter(workspace__slug=slug)
        return Response(
            {"days": [{"id": str(r.id), "date": r.date.isoformat(), "name": r.name} for r in rows]},
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        day = _parse_date(request.data.get("date"))
        if not day:
            return Response({"error": "A valid date is required"}, status=status.HTTP_400_BAD_REQUEST)
        row, _created = WorkspaceNonWorkingDay.objects.update_or_create(
            workspace=workspace,
            date=day,
            defaults={"name": str(request.data.get("name") or "")[:120]},
        )
        return Response({"id": str(row.id), "date": row.date.isoformat(), "name": row.name}, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug):
        day = _parse_date(request.query_params.get("date"))
        if not day:
            return Response({"error": "A valid date is required"}, status=status.HTTP_400_BAD_REQUEST)
        WorkspaceNonWorkingDay.objects.filter(workspace__slug=slug, date=day).delete()
        return Response({"deleted": True}, status=status.HTTP_200_OK)


class WorkspaceRoleRatesEndpoint(BaseAPIView):
    """What an hour of each discipline costs. Reading is open to anyone who can see
    the workspace; writing is admin-only — a rate is a commercial fact."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        rows = WorkspaceRoleRate.objects.filter(workspace__slug=slug)
        return Response(
            {
                "rates": [
                    {
                        "role": r.role,
                        "hourly_rate": float(r.hourly_rate),
                        "hours_per_day": float(r.hours_per_day),
                        "currency": r.currency,
                    }
                    for r in rows
                ],
                # The vocabulary a rate can attach to, so the UI offers the
                # disciplines that exist rather than a free-text box.
                "known_roles": list(PROJECT_ROLES),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def put(self, request, slug):
        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        rows = request.data.get("rates")
        if not isinstance(rows, list):
            return Response({"error": "rates must be a list"}, status=status.HTTP_400_BAD_REQUEST)

        saved = []
        for entry in rows[:100]:
            if not isinstance(entry, dict):
                continue
            role = str(entry.get("role") or "").strip().lower()[:80]
            if not role:
                continue
            try:
                hourly = max(0, min(100000, float(entry.get("hourly_rate") or 0)))
                per_day = max(0.5, min(24, float(entry.get("hours_per_day") or 7)))
            except (TypeError, ValueError):
                continue
            row, _ = WorkspaceRoleRate.objects.update_or_create(
                workspace=workspace,
                role=role,
                defaults={
                    "hourly_rate": hourly,
                    "hours_per_day": per_day,
                    "currency": str(entry.get("currency") or "EUR").strip().upper()[:3],
                },
            )
            saved.append(
                {
                    "role": row.role,
                    "hourly_rate": float(row.hourly_rate),
                    "hours_per_day": float(row.hours_per_day),
                    "currency": row.currency,
                }
            )
        return Response({"rates": saved}, status=status.HTTP_200_OK)


def _is_project_lead(user, project_id):
    """Whether this person owns the project's budget.

    Two ways to be the lead, because the fork has two rosters and both are real:
    Plane's own `Project.project_lead`, and an arribada roster row flagged
    `is_lead` — which exists precisely because most of the team has no Plane
    account. Either counts.

    A workspace admin is deliberately NOT included. Admin is a permission level;
    owning a budget is a job. Letting every admin approve spending on every project
    is how "the lead approves it" becomes "somebody approved it".
    """
    if not user or not getattr(user, "id", None):
        return False
    if Project.objects.filter(id=project_id, project_lead_id=user.id).exists():
        return True
    return ProjectTeamMember.objects.filter(
        project_id=project_id, member_id=user.id, is_lead=True
    ).exists()


def _lead_guard(request, project_id):
    """403 body when the caller is not the lead, else None."""
    if _is_project_lead(request.user, project_id):
        return None
    return Response(
        {
            "error": "Only the project lead can do this.",
            "detail": "Anyone on the project can raise a purchase request; the lead approves it.",
        },
        status=status.HTTP_403_FORBIDDEN,
    )


class ProjectExpensesEndpoint(BaseAPIView):
    """Everything a project spends that is not somebody's time."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        rows = ProjectExpense.objects.filter(project_id=project_id)
        return Response({"expenses": [_serialize_expense(r) for r in rows]}, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        # The sheet is the record of what was committed, so only its owner writes
        # to it. Everyone else raises a request, which the lead turns into a line.
        denied = _lead_guard(request, project_id)
        if denied:
            return denied
        label = str(request.data.get("label") or "").strip()[:255]
        if not label:
            return Response({"error": "A label is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = max(0, min(10**9, float(request.data.get("amount") or 0)))
            quantity = max(0, min(100000, float(request.data.get("quantity") or 1)))
        except (TypeError, ValueError):
            return Response({"error": "Amount and quantity must be numbers"}, status=status.HTTP_400_BAD_REQUEST)

        row = ProjectExpense.objects.create(
            project=project,
            category=str(request.data.get("category") or ProjectExpense.OTHER)[:16],
            label=label,
            amount=amount,
            quantity=quantity,
            currency=str(request.data.get("currency") or "EUR").strip().upper()[:3],
            planned=bool(request.data.get("planned", True)),
            incurred_on=_parse_date(request.data.get("incurred_on")),
            notes=str(request.data.get("notes") or "")[:2000],
            created_by=request.user,
        )
        return Response(_serialize_expense(row), status=status.HTTP_201_CREATED)


class ProjectExpenseDetailEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, project_id, expense_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        denied = _lead_guard(request, project_id)
        if denied:
            return denied
        row = ProjectExpense.objects.filter(id=expense_id, project_id=project_id).first()
        if not row:
            return Response({"error": "Expense not found"}, status=status.HTTP_404_NOT_FOUND)

        if "label" in request.data:
            label = str(request.data.get("label") or "").strip()[:255]
            if not label:
                return Response({"error": "A label is required"}, status=status.HTTP_400_BAD_REQUEST)
            row.label = label
        for field, cap in (("amount", 10**9), ("quantity", 100000)):
            if field in request.data:
                try:
                    setattr(row, field, max(0, min(cap, float(request.data.get(field) or 0))))
                except (TypeError, ValueError):
                    return Response({"error": f"{field} must be a number"}, status=status.HTTP_400_BAD_REQUEST)
        if "category" in request.data:
            row.category = str(request.data.get("category") or ProjectExpense.OTHER)[:16]
        if "currency" in request.data:
            row.currency = str(request.data.get("currency") or "EUR").strip().upper()[:3]
        if "planned" in request.data:
            row.planned = bool(request.data.get("planned"))
        if "incurred_on" in request.data:
            row.incurred_on = _parse_date(request.data.get("incurred_on"))
        if "notes" in request.data:
            row.notes = str(request.data.get("notes") or "")[:2000]
        row.save()
        return Response(_serialize_expense(row), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, project_id, expense_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        denied = _lead_guard(request, project_id)
        if denied:
            return denied
        ProjectExpense.objects.filter(id=expense_id, project_id=project_id).delete()
        return Response({"deleted": True}, status=status.HTTP_200_OK)


def _serialize_expense(row):
    return {
        "id": str(row.id),
        "category": row.category,
        "label": row.label,
        "amount": float(row.amount),
        "quantity": float(row.quantity),
        "total": float(row.total),
        "currency": row.currency,
        "planned": row.planned,
        "incurred_on": row.incurred_on.isoformat() if row.incurred_on else None,
        "notes": row.notes,
    }


class ProjectBudgetEndpoint(BaseAPIView):
    """What this project costs: the human time its plan implies, plus what it spends.

    The two halves are reported apart and never blended, because they are known to
    different degrees. Labour is *derived* — it moves the moment somebody drags a
    bar — while an expense is a number a person typed and often has a receipt for.
    Presenting a single figure would give the estimate the authority of the receipt.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        # Labour from the work items that exist, not from a plan preview: this is
        # the cost of what the project actually holds.
        rows = list(
            Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug)
            .filter(start_date__isnull=False, target_date__isnull=False)
            .values("id", "start_date", "target_date")
        )
        roles = {
            str(r.issue_id): r.role
            for r in IssueRole.objects.filter(issue__project_id=project_id).only("issue_id", "role")
        }
        tasks = [
            {
                "role": roles.get(str(r["id"])),
                # Working days the item occupies, which is what a rate is applied to.
                "days": _working_days_between(r["start_date"], r["target_date"]),
            }
            for r in rows
        ]
        labour = _labour_cost(tasks, _rate_map(slug))

        expenses = list(ProjectExpense.objects.filter(project_id=project_id))
        by_category = {}
        spend_totals = {}
        for row in expenses:
            bucket = by_category.setdefault(
                row.category, {"category": row.category, "planned": 0.0, "actual": 0.0, "currency": row.currency}
            )
            bucket["planned" if row.planned else "actual"] += float(row.total)
            key = (row.currency, row.planned)
            spend_totals[key] = spend_totals.get(key, 0.0) + float(row.total)

        schedule_row = ProjectSchedule.objects.filter(project_id=project_id).first()
        allocated = float(schedule_row.budget_amount) if schedule_row and schedule_row.budget_amount is not None else None
        allocation_currency = (schedule_row.budget_currency if schedule_row else None) or "EUR"

        # What has been committed against the allocation, in the allocation's own
        # currency only. Anything billed in another currency is counted separately
        # and named, rather than converted at a rate nobody in this system chose.
        committed = 0.0
        other_currencies = set()
        for row in labour["totals"]:
            if row["currency"] == allocation_currency:
                committed += row["amount"]
            else:
                other_currencies.add(row["currency"])
        for row in expenses:
            if row.currency == allocation_currency:
                committed += float(row.total)
            else:
                other_currencies.add(row.currency)

        return Response(
            {
                "allocation": {
                    "amount": allocated,
                    "currency": allocation_currency,
                    "committed": round(committed, 2),
                    # None rather than 0 when nothing is allocated: a project with no
                    # budget recorded is not a project that is 100% over.
                    "remaining": None if allocated is None else round(allocated - committed, 2),
                    "percent": None
                    if not allocated
                    else round(100 * committed / allocated),
                    # Named so a figure that does not count toward the allocation is
                    # visible rather than quietly missing from it.
                    "excluded_currencies": sorted(other_currencies),
                },
                "labour": labour,
                "expenses": {
                    "by_category": sorted(
                        by_category.values(), key=lambda c: -(c["planned"] + c["actual"])
                    ),
                    "planned": [
                        {"currency": c, "amount": round(v, 2)}
                        for (c, planned), v in sorted(spend_totals.items())
                        if planned
                    ],
                    "actual": [
                        {"currency": c, "amount": round(v, 2)}
                        for (c, planned), v in sorted(spend_totals.items())
                        if not planned
                    ],
                    "count": len(expenses),
                },
            },
            status=status.HTTP_200_OK,
        )


def _working_days_between(start, end):
    """Inclusive working days between two dates; 1 when they are the same day."""
    if not start or not end or end < start:
        return 1
    day, count = start, 0
    while day <= end:
        if day.weekday() < 5:
            count += 1
        day += timedelta(days=1)
    return max(1, count)


def _serialize_request(row):
    return {
        "id": str(row.id),
        "category": row.category,
        "label": row.label,
        "amount": float(row.amount),
        "quantity": float(row.quantity),
        "total": float(row.total),
        "currency": row.currency,
        "supplier": row.supplier,
        "justification": row.justification,
        "needed_by": row.needed_by.isoformat() if row.needed_by else None,
        "status": row.status,
        "requested_by": str(row.requested_by_id) if row.requested_by_id else None,
        "requested_by_name": (
            row.requested_by.display_name or row.requested_by.email if row.requested_by else None
        ),
        "decided_by_name": (
            row.decided_by.display_name or row.decided_by.email if row.decided_by else None
        ),
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decision_note": row.decision_note,
        "expense_id": str(row.expense_id) if row.expense_id else None,
        "created_at": row.created_at.isoformat(),
    }


class ProjectProcurementEndpoint(BaseAPIView):
    """Purchase requests: anyone on the project may raise one, the lead answers.

    The split is the point. The expense sheet is what the project has committed,
    so it belongs to whoever answers for the budget; everybody else asks. A request
    is inert until approved — approval is what writes the money down.
    """

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        rows = ProcurementRequest.objects.filter(project_id=project_id).select_related(
            "requested_by", "decided_by"
        )
        return Response(
            {
                "requests": [_serialize_request(r) for r in rows],
                # The client needs to know whether to render an approve button at
                # all; asking it to infer that from the roster would be a second
                # implementation of the same rule.
                "can_approve": _is_project_lead(request.user, project_id),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id):
        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        label = str(request.data.get("label") or "").strip()[:255]
        if not label:
            return Response({"error": "Say what you need"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = max(0, min(10**9, float(request.data.get("amount") or 0)))
            quantity = max(0, min(100000, float(request.data.get("quantity") or 1)))
        except (TypeError, ValueError):
            return Response({"error": "Amount and quantity must be numbers"}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= 0:
            return Response({"error": "A price is required"}, status=status.HTTP_400_BAD_REQUEST)

        row = ProcurementRequest.objects.create(
            project=project,
            requested_by=request.user,
            category=str(request.data.get("category") or ProjectExpense.OTHER)[:16],
            label=label,
            amount=amount,
            quantity=quantity,
            currency=str(request.data.get("currency") or "EUR").strip().upper()[:3],
            supplier=str(request.data.get("supplier") or "")[:255],
            justification=str(request.data.get("justification") or "")[:2000],
            needed_by=_parse_date(request.data.get("needed_by")),
        )
        return Response(_serialize_request(row), status=status.HTTP_201_CREATED)


class ProjectProcurementDecisionEndpoint(BaseAPIView):
    """Approve or reject a request. Lead only, and approval is what spends."""

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, project_id, request_id):
        project = _visible_projects(request, slug).filter(id=project_id).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        denied = _lead_guard(request, project_id)
        if denied:
            return denied

        row = ProcurementRequest.objects.filter(id=request_id, project_id=project_id).first()
        if not row:
            return Response({"error": "Request not found"}, status=status.HTTP_404_NOT_FOUND)

        decision = str(request.data.get("decision") or "").strip().lower()
        if decision not in {ProcurementRequest.APPROVED, ProcurementRequest.REJECTED}:
            return Response(
                {"error": "decision must be 'approved' or 'rejected'"}, status=status.HTTP_400_BAD_REQUEST
            )

        note = str(request.data.get("note") or "")[:2000]

        with transaction.atomic():
            if decision == ProcurementRequest.APPROVED:
                # Approving twice must not spend twice. The existing line is reused
                # rather than a second one created — an idempotent approve is worth
                # more than an error message about a button somebody pressed again.
                if row.expense_id:
                    expense = ProjectExpense.objects.filter(id=row.expense_id).first()
                else:
                    expense = None
                if not expense:
                    expense = ProjectExpense.objects.create(
                        project=project,
                        category=row.category,
                        label=row.label,
                        amount=row.amount,
                        quantity=row.quantity,
                        currency=row.currency,
                        # Approved is committed, not yet paid: it belongs in the
                        # budget half until somebody marks it spent.
                        planned=True,
                        notes=(
                            f"Requested by {row.requested_by.display_name or row.requested_by.email}"
                            if row.requested_by
                            else "From a purchase request"
                        )
                        + (f" — {row.supplier}" if row.supplier else ""),
                        created_by=request.user,
                    )
                    row.expense = expense
            else:
                # Rejecting something previously approved takes the money back out.
                # Leaving the line would make a rejected request cost the project.
                if row.expense_id:
                    ProjectExpense.objects.filter(id=row.expense_id).delete()
                    row.expense = None

            row.status = decision
            row.decided_by = request.user
            row.decided_at = timezone.now()
            row.decision_note = note
            row.save()

        return Response(_serialize_request(row), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, project_id, request_id):
        """Withdraw a request. The person who raised it may take it back while it is
        still pending; the lead may remove any of them."""
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        row = ProcurementRequest.objects.filter(id=request_id, project_id=project_id).first()
        if not row:
            return Response({"error": "Request not found"}, status=status.HTTP_404_NOT_FOUND)

        is_lead = _is_project_lead(request.user, project_id)
        own_and_pending = row.requested_by_id == request.user.id and row.status == ProcurementRequest.PENDING
        if not (is_lead or own_and_pending):
            return Response(
                {"error": "You can only withdraw your own request while it is still pending."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Deleting an approved request must not leave its money behind.
        if row.expense_id:
            ProjectExpense.objects.filter(id=row.expense_id).delete()
        row.delete()
        return Response({"deleted": True}, status=status.HTTP_200_OK)
