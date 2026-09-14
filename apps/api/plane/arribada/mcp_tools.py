# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The tools an agent may call, and the three gates every call passes through.

WHY THIS FILE CALLS VIEWS INSTEAD OF QUERYING. Almost every tool here dispatches
into an endpoint that already exists in `views.py`, in-process, through a
synthesised request carrying the token's user. That is not indirection for its
own sake — it is the only way to get two properties this fork cannot afford to
lose:

  1. **One implementation of every number.** The Finance figures reach funders.
     A second implementation of `_labour_cost` or `_budget_display` living here
     would be a second answer, and the failure mode of a second answer is not a
     crash — it is a plausible wrong figure in a funder report, which is the one
     thing this codebase says is worse than an outage. `get_project_budget` and
     `ProjectBudgetEndpoint` cannot disagree, because they are the same code.

  2. **One implementation of every permission.** `allow_permission` runs on the
     synthesised request exactly as it runs on a browser's, so the fork's rule —
     a route that names a project decides on the caller's role IN THAT PROJECT —
     holds for an agent without being restated. Restating it is how it rots.

The three gates, in order, all in `call_tool`:

  1. **The token's own grant.** Scope (read / write), the money flag, and the
     project allow-list. This can only SUBTRACT from what the user may do.
  2. **The user's permissions**, asked by the endpoint itself, of `token.user`.
  3. **The project's consent to be written into**, `ProjectSchedule.external_edits`
     — the same switch the wiki sync answers to, and off by default, so no
     project accepts an agent's writes until somebody turns it on.

Gate 1 is ours and gates 2 and 3 are the product's. A tool that skipped gate 1
would still be safe; a tool that skipped gate 2 would not, which is why gate 2 is
not implemented here at all.
"""

import json
import sys
import uuid
from datetime import datetime
from io import BytesIO
from urllib.parse import urlencode

from django.conf import settings
from django.core.handlers.wsgi import WSGIRequest
from django.utils import timezone

from plane.db.models import Issue, IssueAssignee, IssueComment, Project, ProjectMember, State

from .models import IssueChecklistItem, IssueEffort, IssueMilestone, IssueRole, MCPToken


class ToolError(Exception):
    """A refusal or a bad argument, phrased for the agent that will read it.

    Everything raised here reaches the model as the text of an `isError` result,
    so the message is the entire user interface of this server. It says what was
    refused AND what would have worked — an agent told only "forbidden" retries
    the same call, while an agent told "this token is read-only; ask the workspace
    admin for a write token" stops and reports something a human can act on.
    """


class Ctx:
    """Everything a handler needs: who is asking, and what they were granted."""

    def __init__(self, token):
        self.token = token
        self.user = token.user
        self.workspace = token.workspace
        self.slug = token.workspace.slug


# ---------------------------------------------------------------------------
# Calling a view in-process
# ---------------------------------------------------------------------------

# A handful of code paths in this product build absolute URLs from the request
# host. None of the endpoints reached from here do — but a tool added later
# might, and a hostname out of a synthesised request landing in a notification
# link is the kind of defect that ships because nobody looked.
def _server_name():
    base = getattr(settings, "WEB_URL", None) or getattr(settings, "APP_BASE_URL", None) or ""
    host = base.split("://")[-1].split("/")[0].split(":")[0]
    return host or "localhost"


def _build_request(method, path, query=None, body=None):
    """A WSGIRequest, built by hand.

    `django.test.RequestFactory` does exactly this and is the obvious tool —
    but it lives in `django.test`, and importing that module from production
    code drags `django.test.signals` into the running server's import graph,
    which connects a dozen receivers to `setting_changed` in a process that is
    not a test. It works. It is also the sort of thing that works until the day
    it does not, and a reviewer is right to stop on it. Twenty lines is a
    cheaper answer than explaining the import forever.

    Everything below is what a WSGI server would have put in `environ`. The
    body is JSON because every write reached from here sends JSON; DRF reads
    `CONTENT_TYPE` and parses `wsgi.input` exactly as it does for a browser.
    """
    payload = b"" if body is None else json.dumps(body).encode("utf-8")
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": urlencode(query or {}, doseq=True),
        "SERVER_NAME": _server_name(),
        "SERVER_PORT": "443",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "CONTENT_TYPE": "application/json",
        "CONTENT_LENGTH": str(len(payload)),
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "https",
        "wsgi.input": BytesIO(payload),
        "wsgi.errors": sys.stderr,
        "wsgi.multithread": True,
        "wsgi.multiprocess": True,
        "wsgi.run_once": False,
    }
    return WSGIRequest(environ)


def _call_endpoint(ctx, view_cls, method="GET", path="/", kwargs=None, query=None, body=None):
    """Run `view_cls` as `ctx.user` and return its payload, or raise ToolError.

    `BaseSessionAuthentication` reads `request._request.user`, which is the
    attribute set below, so DRF authenticates this request as the token's user
    without a session ever existing. The fork disables CSRF on that class, so a
    POST needs no token — see `plane/authentication/session.py`.

    Non-2xx becomes a ToolError carrying the endpoint's own message. That matters
    for the 403s: the message an endpoint writes when it refuses is usually more
    specific than anything this layer could invent ("Only the project lead can
    change the plan", and the sentence after it that says what you CAN do).
    """
    kwargs = kwargs or {}
    request = _build_request(method, path, query=query, body=None if method == "GET" else (body or {}))
    request.user = ctx.user

    response = view_cls.as_view()(request, **kwargs)

    status_code = getattr(response, "status_code", 500)
    data = getattr(response, "data", None)
    if status_code >= 400:
        detail = ""
        if isinstance(data, dict):
            detail = data.get("error") or data.get("detail") or ""
            if data.get("detail") and data.get("error") and data["detail"] != data["error"]:
                detail = f"{data['error']} {data['detail']}"
        raise ToolError(str(detail) or f"The server refused this request ({status_code}).")
    return data


# ---------------------------------------------------------------------------
# Resolving what the agent named
# ---------------------------------------------------------------------------


def _visible(ctx):
    """The projects `ctx.user` is an active member of. Any role, GUEST included —
    this answers "may they SEE it", the same question `_visible_projects` asks."""
    return Project.objects.filter(
        workspace__slug=ctx.slug,
        project_projectmember__member=ctx.user,
        project_projectmember__is_active=True,
    ).distinct()


def resolve_project(ctx, value):
    """A project id, its identifier (`TAG`), or its name — to a Project.

    Agents work from what a human said, and a human says "the turtle tracker",
    not a UUID. Ambiguity is refused with the candidates listed rather than
    resolved by picking the first: guessing which project somebody meant is
    exactly the kind of silent wrong answer this codebase keeps paying for.

    The allow-list is checked here, on the way out, so it covers every tool that
    takes a project without each of them remembering to ask.
    """
    if not value or not str(value).strip():
        raise ToolError("A project is required. Call `list_projects` to see what this token can reach.")
    value = str(value).strip()
    visible = _visible(ctx)

    match = None
    try:
        match = visible.filter(id=uuid.UUID(value)).first()
    except (ValueError, AttributeError, TypeError):
        pass
    if match is None:
        match = visible.filter(identifier__iexact=value).first()
    if match is None:
        exact = list(visible.filter(name__iexact=value)[:5])
        if len(exact) == 1:
            match = exact[0]
        elif len(exact) > 1:
            raise ToolError(
                "More than one project is called that: "
                + ", ".join(f"{p.name} ({p.identifier})" for p in exact)
                + ". Name it by its identifier."
            )
    if match is None:
        partial = list(visible.filter(name__icontains=value)[:6])
        if len(partial) == 1:
            match = partial[0]
        elif len(partial) > 1:
            raise ToolError(
                f"'{value}' matches several projects: "
                + ", ".join(f"{p.name} ({p.identifier})" for p in partial)
                + ". Name it by its identifier."
            )
    if match is None:
        raise ToolError(
            f"No project called '{value}' that this token can see. "
            "Call `list_projects` for the list."
        )

    if not ctx.token.allows_project(match.id):
        raise ToolError(
            f"This token is restricted to a named set of projects and "
            f"{match.name} ({match.identifier}) is not one of them."
        )
    return match


def resolve_issue(ctx, project, value):
    """`ARB-42`, `42`, a UUID, or enough of the title — to an Issue."""
    if not value or not str(value).strip():
        raise ToolError("A work item is required: its reference (e.g. ARB-42), its id, or its title.")
    value = str(value).strip()
    items = Issue.issue_objects.filter(project_id=project.id, workspace__slug=ctx.slug)

    try:
        found = items.filter(id=uuid.UUID(value)).first()
        if found:
            return found
    except (ValueError, AttributeError, TypeError):
        pass

    ref = value.upper()
    if ref.startswith(f"{project.identifier.upper()}-"):
        ref = ref.split("-", 1)[1]
    if ref.isdigit():
        found = items.filter(sequence_id=int(ref)).first()
        if found:
            return found
        raise ToolError(f"{project.identifier}-{ref} does not exist in {project.name}.")

    matches = list(items.filter(name__icontains=value)[:6])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ToolError(
            f"'{value}' matches several work items: "
            + ", ".join(f"{project.identifier}-{i.sequence_id} {i.name}" for i in matches)
            + ". Name one by its reference."
        )
    raise ToolError(f"No work item in {project.name} matches '{value}'.")


def _ref(project, issue):
    return f"{project.identifier}-{issue.sequence_id}"


def _scoped_list(ctx, rows, key, what):
    """Narrow a workspace-wide list to the token's project allow-list.

    FAILS CLOSED on a shape it does not recognise, and that is the whole reason
    it exists rather than being three inline `if isinstance(...)` lines. The
    inline version of this guessed a wrapper key that `PortfolioEndpoint` does
    not use, matched nothing, and returned the list unfiltered — an allow-list
    that silently stopped being one. Every endpoint wrapped here answers with a
    list of dicts today; if one ever stops, this raises instead of leaking.
    """
    if not ctx.token.project_ids:
        return rows
    if not isinstance(rows, list):
        raise ToolError(
            f"This token is restricted to a named set of projects, and the {what} list came "
            "back in a shape this server cannot scope. Refusing rather than answering with "
            "more than the token allows. This is a bug — report it."
        )
    out = []
    for row in rows:
        if not isinstance(row, dict) or key not in row:
            raise ToolError(
                f"This token is restricted to a named set of projects, and a row in the {what} "
                f"list carries no '{key}' to scope it by. Refusing rather than guessing."
            )
        if ctx.token.allows_project(row[key]):
            out.append(row)
    return out


# ---------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------


def t_whoami(ctx, args):
    """Deliberately the first tool in the list and the one to call when anything
    is refused: it says what this credential may do, so the agent stops guessing
    whether a 403 was the token or the account."""
    token = ctx.token
    projects = [
        {"id": str(p.id), "identifier": p.identifier, "name": p.name}
        for p in _visible(ctx).order_by("name")
        if token.allows_project(p.id)
    ]
    return {
        "user": {
            "email": ctx.user.email,
            "display_name": ctx.user.display_name or ctx.user.first_name or ctx.user.email,
            "timezone": ctx.user.user_timezone,
        },
        "workspace": {"slug": ctx.slug, "name": ctx.workspace.name},
        "token": {
            "name": token.name,
            "prefix": token.prefix,
            "scope": token.scope,
            "may_write": token.scope == MCPToken.SCOPE_WRITE,
            "may_read_money": token.allow_money,
            "restricted_to_projects": bool(token.project_ids),
            "expires_at": token.expires_at.isoformat(),
        },
        "reachable_projects": projects,
        "note": (
            "Permissions are the intersection of this token's grant and the user's own role "
            "in each project. A refusal may come from either."
        ),
    }


def t_list_projects(ctx, args):
    from .views import PortfolioEndpoint

    data = _call_endpoint(
        ctx,
        PortfolioEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/portfolio/",
        kwargs={"slug": ctx.slug},
        query={"include_archived": "true" if args.get("include_archived") else "false"},
    )
    # `PortfolioEndpoint` answers with a FLAT LIST of projects. The first draft of
    # this function guessed `{"projects": [...]}`, found no such key, and passed
    # the payload through untouched — so a token restricted to one project listed
    # every project its user could see, and the test that was supposed to cover it
    # only ever exercised `list_work_items`. Hence `_scoped_list` below, which
    # REFUSES a shape it does not recognise instead of returning it: an
    # allow-list that cannot find the ids it is meant to filter has failed, and
    # failing open is how it fails silently.
    return _scoped_list(ctx, data, key="id", what="projects")


def t_get_project(ctx, args):
    from .views import ProjectOverviewEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectOverviewEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/overview/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_list_work_items(ctx, args):
    from .views import PortfolioItemsEndpoint

    project = resolve_project(ctx, args.get("project"))
    rows = _call_endpoint(
        ctx,
        PortfolioItemsEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/items/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
        query={"undated": "true"} if args.get("undated_only") else {},
    )
    rows = rows if isinstance(rows, list) else []

    # The endpoint answers with state ids because its caller — the timeline — has
    # the state list already. An agent does not, so the group is joined on here.
    # Filtering happens after the endpoint rather than inside it: the endpoint is
    # shared with the timeline and narrowing it there would narrow that too.
    groups = dict(
        State.objects.filter(project_id=project.id).values_list("id", "group")
    )
    names = dict(State.objects.filter(project_id=project.id).values_list("id", "name"))
    for row in rows:
        sid = row.get("state_id")
        key = uuid.UUID(sid) if isinstance(sid, str) else sid
        row["state_group"] = groups.get(key)
        row["state"] = names.get(key)
        row["reference"] = f"{project.identifier}-{row.get('sequence_id')}"

    wanted = args.get("state_group")
    if wanted:
        rows = [r for r in rows if r.get("state_group") == wanted]
    if args.get("open_only"):
        rows = [r for r in rows if r.get("state_group") not in ("completed", "cancelled")]
    if args.get("overdue"):
        today = timezone.localdate().isoformat()
        rows = [
            r
            for r in rows
            if r.get("target_date")
            and str(r["target_date"]) < today
            and r.get("state_group") not in ("completed", "cancelled")
        ]
    if args.get("assignee"):
        # `name` and not `display_name`/`email`: `PortfolioItemsEndpoint` builds
        # its assignee dicts as {id, name, avatar}, where `name` is already
        # `display_name or first_name or email`. Matching a key the payload does
        # not carry would have made this filter return nothing, always — and a
        # filter that returns nothing is indistinguishable from a filter that
        # works, which is why `test_filtering_by_assignee_finds_the_assignee`
        # asserts on a specific row rather than on a length.
        needle = str(args["assignee"]).lower()
        rows = [
            r
            for r in rows
            if any(needle in (a.get("name") or "").lower() for a in (r.get("assignees") or []))
        ]
    if args.get("query"):
        needle = str(args["query"]).lower()
        rows = [r for r in rows if needle in (r.get("name") or "").lower()]

    limit = min(int(args.get("limit") or 100), 500)
    return {
        "project": {"id": str(project.id), "identifier": project.identifier, "name": project.name},
        "count": len(rows),
        "returned": min(len(rows), limit),
        "items": rows[:limit],
        # Said out loud rather than silently truncated: a list that stops at its
        # ceiling and does not mention it reads as a complete answer.
        "truncated": len(rows) > limit,
    }


def t_get_work_item(ctx, args):
    project = resolve_project(ctx, args.get("project"))
    issue = resolve_issue(ctx, project, args.get("item"))

    assignees = [
        {"email": a.assignee.email, "display_name": a.assignee.display_name}
        for a in IssueAssignee.objects.filter(
            issue_id=issue.id, deleted_at__isnull=True
        ).select_related("assignee")
    ]
    effort = IssueEffort.objects.filter(issue_id=issue.id).first()
    milestone = IssueMilestone.objects.filter(issue_id=issue.id).first()
    roles = list(
        IssueRole.objects.filter(issue_id=issue.id).values_list("role", flat=True)
    )
    checklist = [
        {
            "reference": f"{project.identifier}-{c.member.sequence_id}",
            "name": c.member.name,
            "state_group": c.member.state.group if c.member.state else None,
        }
        for c in IssueChecklistItem.objects.filter(owner_id=issue.id)
        .select_related("member", "member__state")
        .order_by("sort_order")
    ]
    return {
        "reference": _ref(project, issue),
        "id": str(issue.id),
        "project": {"id": str(project.id), "identifier": project.identifier, "name": project.name},
        "name": issue.name,
        "description": issue.description_stripped or "",
        "state": issue.state.name if issue.state else None,
        "state_group": issue.state.group if issue.state else None,
        "priority": issue.priority,
        "start_date": issue.start_date.isoformat() if issue.start_date else None,
        "target_date": issue.target_date.isoformat() if issue.target_date else None,
        "assignees": assignees,
        # Days of effort, which this fork keeps deliberately separate from the
        # dates: an estimate and a window are different facts about one item.
        "effort_days": float(effort.days) if effort and effort.days is not None else None,
        "actual_days": float(effort.actual_days) if effort and effort.actual_days is not None else None,
        "disciplines": roles,
        "milestone": {"kind": milestone.kind, "label": milestone.label} if milestone else None,
        # Checklist items are NOT sub-issues here, on purpose — see ARRIBADA.md.
        "checklist": checklist,
        "external_source": issue.external_source,
        "external_id": issue.external_id,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
    }


def t_my_work(ctx, args):
    from .views import MyWorkEndpoint

    rows = _call_endpoint(
        ctx,
        MyWorkEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/my-work/",
        kwargs={"slug": ctx.slug},
    )
    return _scoped_list(ctx, rows, key="project_id", what="my-work")


def t_list_milestones(ctx, args):
    from .views import ProjectMilestonesEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectMilestonesEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/milestones/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_get_schedule(ctx, args):
    from .views import ProjectScheduleEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectScheduleEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/schedule/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_get_critical_path(ctx, args):
    from .views import ProjectCriticalPathEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectCriticalPathEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/critical-path/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_list_deliverables(ctx, args):
    from .views import WorkspaceDeliverablesEndpoint

    rows = _call_endpoint(
        ctx,
        WorkspaceDeliverablesEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/deliverables/",
        kwargs={"slug": ctx.slug},
    )
    return _scoped_list(ctx, rows, key="project_id", what="deliverables")


def t_get_workload(ctx, args):
    from .views import WorkloadEndpoint

    # REFUSED outright for a project-restricted token, rather than filtered.
    # `WorkloadEndpoint` aggregates every project its caller can see into ONE
    # number per person — assigned, overdue, committed percent — and there is no
    # project id left in the answer to scope by. Returning it would hand a token
    # limited to one project a figure computed from all of them, which is a
    # smaller leak than a project list and is still not what the grant says.
    if ctx.token.project_ids:
        raise ToolError(
            "This token is restricted to a named set of projects, and workload is a single "
            "figure per person aggregated across every project its user can see — there is "
            "nothing in the answer left to narrow. Use an unrestricted token, or read "
            "`list_work_items` per project."
        )
    return _call_endpoint(
        ctx,
        WorkloadEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/workload/",
        kwargs={"slug": ctx.slug},
    )


def t_get_team(ctx, args):
    from .views import ProjectTeamEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectTeamEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/team/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_list_status_updates(ctx, args):
    from .views import ProjectStatusEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectStatusEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/status/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


# ---------------------------------------------------------------------------
# Money tools — gate 1 refuses these unless the token says `allow_money`, and
# gate 2 (MONEY_ROLES on the endpoint) refuses them for a guest regardless.
# ---------------------------------------------------------------------------


def t_get_project_budget(ctx, args):
    from .views import ProjectBudgetEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectBudgetEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/budget/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_list_expenses(ctx, args):
    from .views import ProjectExpensesEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectExpensesEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/expenses/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


def t_list_procurement(ctx, args):
    from .views import ProjectProcurementEndpoint

    project = resolve_project(ctx, args.get("project"))
    return _call_endpoint(
        ctx,
        ProjectProcurementEndpoint,
        path=f"/api/arribada/workspaces/{ctx.slug}/projects/{project.id}/procurement/",
        kwargs={"slug": ctx.slug, "project_id": str(project.id)},
    )


# ---------------------------------------------------------------------------
# Write tools
# ---------------------------------------------------------------------------

# What a created or updated item is stamped with, so every row an agent touched
# can be found later. Migration `0043` indexed `(project_id, external_source)`
# for exactly this, and the v1 API's `?external_source=` filter already reads it.
MCP_SOURCE = "arribada-mcp"

# The fields an agent may NOT set, borrowed from the plan guard rather than
# re-listed, so the two cannot drift. These are THE PLAN — dates, parentage,
# estimates, sprint and module membership — and they belong to the project lead.
# An agent proposing a plan is a feature; an agent writing one silently is the
# thing `lead_only_edits` exists to prevent.
def _plan_fields():
    from .plan_guard import PLAN_FIELDS

    return PLAN_FIELDS


def _writable(ctx, project):
    """Whether `ctx.user` may CHANGE this project — the same two questions
    `_writable_projects` asks, in the same order."""
    from .views import _is_workspace_admin
    from plane.app.permissions import ROLE

    if _is_workspace_admin(ctx.user, ctx.slug):
        return ProjectMember.objects.filter(
            project_id=project.id, member=ctx.user, is_active=True
        ).exists()
    return ProjectMember.objects.filter(
        project_id=project.id,
        member=ctx.user,
        is_active=True,
        role__gte=ROLE.MEMBER.value,
    ).exists()


def _write_guard(ctx, project):
    """Gates 1 and 3 for a write. Gate 2 is `_writable` just above.

    Ordered cheapest-refusal-first, and each refusal names the switch that would
    have let the call through — a message that only says "forbidden" sends the
    agent round the loop again.
    """
    if ctx.token.scope != MCPToken.SCOPE_WRITE:
        raise ToolError(
            "This token is read-only. A write token is issued with "
            "`manage.py mcp_token issue --scope write`."
        )
    if not _writable(ctx, project):
        raise ToolError(
            f"{ctx.user.email} is not a MEMBER or above on {project.name}, so nothing can be "
            "written there through this token."
        )
    from .views import external_edits_allowed

    if not external_edits_allowed(project.id):
        raise ToolError(
            f"{project.name} has not turned on external edits, so it does not accept writes from "
            "an integration. A project lead enables it in the project's schedule settings. This is "
            "the same switch the wiki sync answers to, and it is off until somebody turns it on."
        )


def t_create_work_item(ctx, args):
    project = resolve_project(ctx, args.get("project"))
    _write_guard(ctx, project)

    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("A work item needs a name.")

    state = (
        State.objects.filter(project_id=project.id, default=True).first()
        or State.objects.filter(project_id=project.id).order_by("sequence").first()
    )
    if state is None:
        raise ToolError(f"{project.name} has no states configured, so an item cannot be filed.")

    priority = (args.get("priority") or "none").lower()
    if priority not in ("urgent", "high", "medium", "low", "none"):
        raise ToolError("priority must be one of urgent, high, medium, low, none.")

    issue = Issue.objects.create(
        workspace=project.workspace,
        project=project,
        name=name[:250],
        description_html=f"<p>{_escape(args.get('description') or '')}</p>"
        if args.get("description")
        else "<p></p>",
        priority=priority,
        state=state,
        created_by=ctx.user,
        external_source=MCP_SOURCE,
        external_id=f"{ctx.token.prefix}:{timezone.now():%Y%m%d%H%M%S%f}",
    )

    assigned, refused = _apply_assignees(ctx, project, issue, args.get("assignees") or [])

    return {
        "created": True,
        "reference": _ref(project, issue),
        "id": str(issue.id),
        "name": issue.name,
        "state": state.name,
        "priority": priority,
        "assignees": assigned,
        "assignees_refused": refused,
        # Named rather than left to be discovered: this fork's bulk writers skip
        # the activity feed on purpose (see `ProjectApplyPlanEndpoint`), and an
        # agent that believes it notified somebody has not.
        "note": (
            "Dates, parent and estimate were not set — those are the plan and this tool will not "
            "write them. No activity-feed entry or notification was raised; the item is stamped "
            f"external_source='{MCP_SOURCE}' and the call is in the MCP audit log."
        ),
    }


def t_update_work_item(ctx, args):
    project = resolve_project(ctx, args.get("project"))
    _write_guard(ctx, project)
    issue = resolve_issue(ctx, project, args.get("item"))

    offered = {k for k in args if k not in ("project", "item")}
    forbidden = offered & set(_plan_fields())
    if forbidden:
        raise ToolError(
            "This tool does not write the plan. Refused fields: "
            + ", ".join(sorted(forbidden))
            + ". Dates, parent, estimate and sprint membership are the project lead's; propose "
            "them in a comment instead."
        )

    changed = {}
    if args.get("name"):
        issue.name = str(args["name"])[:250]
        changed["name"] = issue.name
    if args.get("description") is not None:
        issue.description_html = f"<p>{_escape(str(args['description']))}</p>"
        changed["description"] = True
    if args.get("priority"):
        priority = str(args["priority"]).lower()
        if priority not in ("urgent", "high", "medium", "low", "none"):
            raise ToolError("priority must be one of urgent, high, medium, low, none.")
        issue.priority = priority
        changed["priority"] = priority
    if args.get("state"):
        state = State.objects.filter(project_id=project.id, name__iexact=str(args["state"])).first()
        if state is None:
            available = ", ".join(
                State.objects.filter(project_id=project.id).order_by("sequence").values_list("name", flat=True)
            )
            raise ToolError(f"No state called '{args['state']}' in {project.name}. Available: {available}.")
        issue.state = state
        changed["state"] = state.name

    if not changed and not args.get("assignees"):
        raise ToolError("Nothing to change. Pass at least one of name, description, priority, state, assignees.")

    if changed:
        issue.updated_by = ctx.user
        issue.save()

    assigned, refused = ([], [])
    if args.get("assignees"):
        assigned, refused = _apply_assignees(ctx, project, issue, args["assignees"], replace=True)
        changed["assignees"] = assigned

    return {
        "updated": True,
        "reference": _ref(project, issue),
        "changed": changed,
        "assignees_refused": refused,
        "note": "No activity-feed entry was raised. The call is in the MCP audit log.",
    }


def t_add_comment(ctx, args):
    project = resolve_project(ctx, args.get("project"))
    _write_guard(ctx, project)
    issue = resolve_issue(ctx, project, args.get("item"))

    text = (args.get("text") or "").strip()
    if not text:
        raise ToolError("A comment needs some text.")

    comment = IssueComment.objects.create(
        workspace=project.workspace,
        project=project,
        issue=issue,
        actor=ctx.user,
        # Escaped, because this string was written by a language model acting on
        # text it read somewhere, and it is rendered as HTML in a browser.
        comment_html=f"<p>{_escape(text)}</p>",
        comment_stripped=text,
        created_by=ctx.user,
        external_source=MCP_SOURCE,
    )
    return {
        "posted": True,
        "comment_id": str(comment.id),
        "on": _ref(project, issue),
        "by": ctx.user.email,
    }


def _escape(value):
    from django.utils.html import escape

    return escape(str(value))


def _apply_assignees(ctx, project, issue, emails, replace=False):
    """Set owners by email, refusing anyone who is not an assignable member.

    Same rule as Plane's own issue serializer — an ACTIVE project member at
    MEMBER or above — asked in one query rather than one per name. Refusals are
    returned rather than raised: an agent that named four people and got three
    should be told which one it did not get, not have the whole call fail.
    """
    from plane.app.permissions import ROLE

    wanted = [str(e).strip().lower() for e in emails if str(e).strip()]
    if not wanted:
        return ([], [])
    allowed = {
        m["member__email"].lower(): m["member_id"]
        for m in ProjectMember.objects.filter(
            project_id=project.id, is_active=True, role__gte=ROLE.MEMBER.value
        ).values("member_id", "member__email")
    }
    refused = [e for e in wanted if e not in allowed]
    keep = [e for e in wanted if e in allowed]

    if replace:
        IssueAssignee.objects.filter(issue_id=issue.id).exclude(
            assignee_id__in=[allowed[e] for e in keep]
        ).delete()
    for email in keep:
        IssueAssignee.objects.get_or_create(
            issue_id=issue.id,
            assignee_id=allowed[email],
            defaults={"project_id": project.id},
        )
    return (keep, refused)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

_PROJECT_ARG = {
    "type": "string",
    "description": "Project id, identifier (e.g. 'TAG') or name. Partial names are accepted when unambiguous.",
}
_ITEM_ARG = {
    "type": "string",
    "description": "Work item reference (e.g. 'TAG-42'), its id, or enough of its title to be unambiguous.",
}


def _tool(name, description, handler, properties=None, required=None, money=False, write=False):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties or {},
            "required": required or [],
            "additionalProperties": False,
        },
        "handler": handler,
        "money": money,
        "write": write,
    }


TOOLS = [
    _tool(
        "whoami",
        "What this credential is and what it may do: the user it acts as, the workspace, the "
        "scope, whether finance is readable, and which projects are reachable. Call this first, "
        "and call it again whenever something is refused.",
        t_whoami,
    ),
    _tool(
        "list_projects",
        "Every project this token can reach, with its folder, dates, lead and progress. The "
        "portfolio view the team uses.",
        t_list_projects,
        {"include_archived": {"type": "boolean", "description": "Include archived projects."}},
    ),
    _tool(
        "get_project",
        "One project in full: dates, progress, sprints, milestones, roster and recent status.",
        t_get_project,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "list_work_items",
        "Work items of one project, with optional filters. Says when it truncated.",
        t_list_work_items,
        {
            "project": _PROJECT_ARG,
            "state_group": {
                "type": "string",
                "enum": ["backlog", "unstarted", "started", "completed", "cancelled"],
            },
            "open_only": {"type": "boolean", "description": "Exclude completed and cancelled."},
            "overdue": {"type": "boolean", "description": "Only items past their target date and not finished."},
            "undated_only": {"type": "boolean", "description": "Only items with neither a start nor a target date."},
            "assignee": {
                "type": "string",
                "description": "Match an owner by display name (a fragment is enough).",
            },
            "query": {"type": "string", "description": "Match the title."},
            "limit": {"type": "integer", "description": "Default 100, maximum 500."},
        },
        ["project"],
    ),
    _tool(
        "get_work_item",
        "One work item in full: state, dates, owners, effort in days, discipline, milestone and "
        "checklist. Checklist entries are not sub-issues.",
        t_get_work_item,
        {"project": _PROJECT_ARG, "item": _ITEM_ARG},
        ["project", "item"],
    ),
    _tool(
        "my_work",
        "The open work items assigned to the user this token acts as, across the workspace.",
        t_my_work,
    ),
    _tool(
        "list_milestones",
        "The milestones of one project, with their dates and what they depend on.",
        t_list_milestones,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "get_schedule",
        "The plan of one project: dated work items, dependencies, and the governance flags "
        "(lead-only edits, external edits).",
        t_get_schedule,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "get_critical_path",
        "The critical path of one project, with the slack on everything that is not on it.",
        t_get_critical_path,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "list_deliverables",
        "What is promised across the workspace and when, scoped to what this token can reach.",
        t_list_deliverables,
    ),
    _tool(
        "get_workload",
        "Per-person load across the workspace: assigned, overdue, due this week, and committed "
        "capacity as a percentage. Over-committed people first.",
        t_get_workload,
    ),
    _tool(
        "get_team",
        "The roster of one project: who is on it, their discipline, working pattern and leave.",
        t_get_team,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "list_status_updates",
        "The written status updates on one project, most recent first.",
        t_list_status_updates,
        {"project": _PROJECT_ARG},
        ["project"],
    ),
    _tool(
        "get_project_budget",
        "FINANCE. The budget of one project: allocation, labour cost, expenses, spend curve and "
        "what is left. These are the figures funder reports are built from.",
        t_get_project_budget,
        {"project": _PROJECT_ARG},
        ["project"],
        money=True,
    ),
    _tool(
        "list_expenses",
        "FINANCE. Everything one project has spent that is not somebody's time.",
        t_list_expenses,
        {"project": _PROJECT_ARG},
        ["project"],
        money=True,
    ),
    _tool(
        "list_procurement",
        "FINANCE. The purchase requests of one project and where each one stands.",
        t_list_procurement,
        {"project": _PROJECT_ARG},
        ["project"],
        money=True,
    ),
    _tool(
        "create_work_item",
        "Create a work item. Will not set dates, parent or estimate — those are the plan and "
        "belong to the project lead. Requires a write token AND the project to have external "
        "edits turned on.",
        t_create_work_item,
        {
            "project": _PROJECT_ARG,
            "name": {"type": "string", "description": "The title. Truncated at 250 characters."},
            "description": {"type": "string"},
            "priority": {"type": "string", "enum": ["urgent", "high", "medium", "low", "none"]},
            "assignees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Email addresses. Anyone who is not an assignable member is reported back, not silently dropped.",
            },
        },
        ["project", "name"],
        write=True,
    ),
    _tool(
        "update_work_item",
        "Change the name, description, priority, state or owners of a work item. Refuses every "
        "plan field. Requires a write token AND external edits on the project.",
        t_update_work_item,
        {
            "project": _PROJECT_ARG,
            "item": _ITEM_ARG,
            "name": {"type": "string"},
            "description": {"type": "string"},
            "priority": {"type": "string", "enum": ["urgent", "high", "medium", "low", "none"]},
            "state": {"type": "string", "description": "A state name that exists in this project."},
            "assignees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Email addresses. REPLACES the current owners.",
            },
        },
        ["project", "item"],
        write=True,
    ),
    _tool(
        "add_comment",
        "Post a comment on a work item, as the user this token acts as. The way to propose a date "
        "or a plan change rather than making one.",
        t_add_comment,
        {"project": _PROJECT_ARG, "item": _ITEM_ARG, "text": {"type": "string"}},
        ["project", "item", "text"],
        write=True,
    ),
]

TOOLS_BY_NAME = {t["name"]: t for t in TOOLS}


def list_tools(token):
    """The tool list this token should see.

    A tool the token can never call is not advertised. That is politeness to the
    model — it cannot waste a turn on `get_project_budget` with a token that will
    refuse it — and it is not a security control: `call_tool` refuses by grant,
    not by what happened to be listed.
    """
    out = []
    for tool in TOOLS:
        if tool["money"] and not token.allow_money:
            continue
        if tool["write"] and token.scope != MCPToken.SCOPE_WRITE:
            continue
        out.append(
            {
                "name": tool["name"],
                "description": tool["description"],
                "inputSchema": tool["inputSchema"],
            }
        )
    return out


def call_tool(token, name, arguments):
    """Gate 1, then the handler, then the audit row. Always the audit row."""
    from .models import MCPCallLog

    started = timezone.now()
    ctx = Ctx(token)
    arguments = arguments if isinstance(arguments, dict) else {}

    ok, error, payload = True, "", None
    try:
        tool = TOOLS_BY_NAME.get(name)
        if tool is None:
            raise ToolError(
                f"No tool called '{name}'. Available: " + ", ".join(sorted(TOOLS_BY_NAME))
            )
        if tool["money"] and not token.allow_money:
            raise ToolError(
                "This token may not read finance. Budgets, expenses and procurement are behind a "
                "separate grant (`--allow-money`) because those figures reach funders."
            )
        if tool["write"] and token.scope != MCPToken.SCOPE_WRITE:
            raise ToolError("This token is read-only.")
        payload = tool["handler"](ctx, arguments)
    except ToolError as exc:
        ok, error = False, str(exc)
    except Exception as exc:  # noqa: BLE001
        # Deliberately not re-raised. An MCP client shows a transport error as a
        # dead server, and the agent then cannot tell "this tool is broken" from
        # "the whole connection is gone". The type and message go to the log.
        from plane.utils.exception_logger import log_exception

        log_exception(exc)
        ok, error = False, f"{type(exc).__name__}: {exc}"

    MCPCallLog.objects.create(
        token=token,
        token_prefix=token.prefix,
        user=token.user,
        tool=name[:64],
        arguments=json.dumps(arguments, default=str)[:2000],
        ok=ok,
        error=error[:2000],
        duration_ms=int((timezone.now() - started).total_seconds() * 1000),
    )
    if not ok:
        raise ToolError(error)
    return payload


def json_default(value):
    """`Decimal` and `date` reach here from the money endpoints; both must survive
    the trip as their printed form rather than as a serialiser crash."""
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
