# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Count, Max, Min, Q
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssueRelation, Project

from .models import IssueBaseline, ProjectAffineDoc, ProjectSchedule
from .scheduling import cascade, critical_path
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

        return Response(
            list(
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
            ),
            status=status.HTTP_200_OK,
        )


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
    """The issue ids on the project's critical (longest-duration) dependency chain."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        issues, relations = _project_graph(project_id, slug)
        return Response({"issue_ids": sorted(critical_path(issues, relations))}, status=status.HTTP_200_OK)


class ProjectAffineDocEndpoint(BaseAPIView):
    """Read or set the AFFiNE wiki doc a project links to (private deep link)."""

    @allow_permission(allowed_roles=VIEWER_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        mapping = ProjectAffineDoc.objects.filter(project_id=project_id).first()
        if not mapping:
            return Response({"doc_id": None, "workspace_id": None, "title": None}, status=status.HTTP_200_OK)
        return Response(
            {"doc_id": mapping.doc_id, "workspace_id": mapping.workspace_id, "title": mapping.title},
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def put(self, request, slug, project_id):
        if not _visible_projects(request, slug).filter(id=project_id).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        doc_id = (request.data.get("doc_id") or "").strip() or None
        title = (request.data.get("title") or "").strip() or None
        # accept a full AFFiNE url or a bare doc id
        if doc_id and "/" in doc_id:
            doc_id = doc_id.rstrip("/").split("/")[-1]
        mapping, _ = ProjectAffineDoc.objects.get_or_create(project_id=project_id)
        mapping.doc_id = doc_id
        if title is not None:
            mapping.title = title
        mapping.save()
        return Response(
            {"doc_id": mapping.doc_id, "workspace_id": mapping.workspace_id, "title": mapping.title},
            status=status.HTTP_200_OK,
        )


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
