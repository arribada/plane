# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`lead_only_edits`, enforced on the routes this app does not own.

WHY THIS EXISTS AT ALL. `_plan_guard` in `views.py` covers every arribada
endpoint that writes a plan, and that is not most of them. The gantt's bar drag
— the single most obvious way in this product to change when work happens —
posts to upstream's `IssueBulkUpdateDateEndpoint`. The date pickers in the
sidebar and the peek go through `IssueViewSet.partial_update`. Parents,
dependencies, and sprint and module membership are upstream viewsets too. A
setting called "only the lead may edit the timeline" that left all of those open
would be a UI guard with a database column behind it, which is the exact failure
this fork already shipped once: a route the client merely hid.

WHY A MIDDLEWARE RATHER THAN A LINE IN EACH UPSTREAM HANDLER. Ten call sites
across five upstream files is ten merge conflicts every time this fork pulls
from `makeplane/plane`, and a conflict resolved carelessly in a permission is a
permission that silently stops holding. Everything here lives in
`plane/arribada/`, so an upstream merge cannot quietly drop it — and
`test_plan_guard.py` asserts that every name in `GUARDED` still resolves to a
routed view, so an upstream RENAME cannot quietly drop it either. That test is
the whole reason this is safe: without it, a map of class names is a map that
rots into decoration.

`process_view`, not `__call__`: Django has already resolved the URL by then, so
the view class and `project_id` arrive as arguments instead of being re-derived
from the path, and returning a response short-circuits the view. Authentication
has run — every app API view is `BaseSessionAuthentication`, whose user is the
one `django.contrib.auth`'s middleware already put on the request — so
`request.user` here is the user the view would have seen.
"""

import json

from django.http import JsonResponse, QueryDict

# The fields on an issue PATCH that are THE PLAN rather than the work.
#
# `IssueViewSet.partial_update` carries everything: a state change, a rename, a
# priority, a description, a label — and a date. Refusing the whole handler
# would take away the state dropdown, which is the one thing the setting
# promises to leave alone, so the body decides. Anything not named here is
# nobody's business but the person doing the work.
#
# `sort_order` is deliberately ABSENT. Dragging a row up the gantt sidebar
# rearranges a list; it does not move a bar, change a date or alter what depends
# on what, and it is somebody else's area of this codebase besides.
PLAN_FIELDS = frozenset(
    {
        "start_date",
        "target_date",
        # `parent_id` is what the client sends (`IssueCreateSerializer` maps it
        # onto `parent`); both are listed so a caller using either is covered.
        "parent_id",
        "parent",
        # Plane's own size estimate, next to our `IssueEffort` days.
        "estimate_point",
        "estimate_point_id",
        # Neither is normally sent through this route — cycles and modules have
        # their own viewsets, guarded below — but a body that named one here
        # would otherwise be the way around them.
        "cycle_id",
        "module_ids",
    }
)

# (view class name, HTTP method) -> the fields that make it a plan write, or
# None when the route does nothing else.
#
# Every one of these is an upstream class. The arribada endpoints are guarded in
# their own handlers instead, because most of them need the same distinction
# `IssueEffortEndpoint` needs — an estimate is the plan, an actual is not — and a
# middleware cannot see the difference between two branches of one view.
GUARDED = {
    # The gantt bar drag and resize. Writes dates and nothing else.
    ("IssueBulkUpdateDateEndpoint", "POST"): None,
    # The date pickers, the parent picker, and every other property edit.
    ("IssueViewSet", "PATCH"): PLAN_FIELDS,
    # "Add existing sub-issue" — bulk-writes `parent`.
    ("SubIssuesEndpoint", "POST"): None,
    # `create` and `remove_relation` are both POST on this class.
    ("IssueRelationViewSet", "POST"): None,
    # Sprint membership.
    ("CycleIssueViewSet", "POST"): None,
    ("CycleIssueViewSet", "DELETE"): None,
    ("TransferCycleIssueEndpoint", "POST"): None,
    # Module membership.
    ("ModuleIssueViewSet", "POST"): None,
    ("ModuleIssueViewSet", "DELETE"): None,
}

UNSAFE = frozenset({"POST", "PATCH", "PUT", "DELETE"})


def _body_keys(request):
    """The top-level keys of the request body, or None when they cannot be read.

    None means "cannot tell", and the caller treats that as a plan write —
    FAIL CLOSED. It costs nothing in practice: the guard is only consulted on a
    project that has opted in, and only for a caller who is neither its lead nor
    a workspace admin, so the worst case is that somebody sending a body this
    cannot parse is refused rather than 400'd. A permission that fails open on a
    body it does not understand is a permission with a documented bypass.
    """
    content_type = (request.content_type or "").split(";")[0].strip().lower()
    try:
        body = request.body
    except Exception:
        # The stream was already consumed, or is too large to hold. Neither
        # happens on these routes; if it ever does, refuse rather than guess.
        return None
    if not body:
        return set()
    if content_type == "application/json":
        try:
            data = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            return None
        return set(data) if isinstance(data, dict) else None
    if content_type == "application/x-www-form-urlencoded":
        # Django only fills `request.POST` for POST; PATCH has to be parsed.
        return set(QueryDict(body).keys())
    return None


class PlanEditGuardMiddleware:
    """Refuses upstream plan writes on a project whose plan is the lead's.

    Does nothing at all — not even a query — unless the request is an unsafe
    method on one of the nine routed handlers in `GUARDED`. On those, it costs
    one indexed existence check, and reaches the second query only on a project
    that has turned the setting on.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if request.method not in UNSAFE:
            return None
        view_class = getattr(view_func, "cls", None) or getattr(view_func, "view_class", None)
        if view_class is None:
            return None
        rule = GUARDED.get((view_class.__name__, request.method), "unguarded")
        if rule == "unguarded":
            return None
        project_id = view_kwargs.get("project_id")
        if not project_id:
            return None

        # `_force_auth_user` FIRST, and it is not a bypass.
        #
        # DRF's `APIClient.force_authenticate` sets that attribute on the Django
        # request and leaves `request.user` anonymous until the view builds its
        # own request — so a middleware that read only `request.user` would see
        # AnonymousUser for every test in this repository, fall through the
        # `is_authenticated` check below, and refuse nothing. Every test of this
        # guard would then pass while the guard did nothing at all, which is the
        # single worst outcome available for a permission.
        #
        # Not reachable from outside: it is a Python attribute set by the test
        # client, not a header, a cookie or a body field. In production it is
        # always None and `request.user` — put there by `AuthenticationMiddleware`
        # from the session every app API view authenticates from — is the answer.
        user = getattr(request, "_force_auth_user", None) or getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            # Not our refusal to make. The view's own authentication answers 401,
            # and pre-empting it here would turn "you are not signed in" into
            # "you are not the lead", which is a worse thing to read and a worse
            # thing to debug.
            return None

        # Deferred to keep this module importable before the app registry is
        # ready, and to keep ONE definition of who the lead is.
        from .views import _may_edit_plan, plan_edits_are_lead_only

        if not plan_edits_are_lead_only(project_id):
            return None
        if rule is not None:
            keys = _body_keys(request)
            if keys is not None and not (keys & rule):
                return None
        if _may_edit_plan(user, project_id):
            return None

        from .views import PLAN_LINE_EVERYONE, PLAN_LINE_LEAD

        return JsonResponse(
            {
                "error": "Only the project lead can change the plan.",
                "detail": (
                    f"This project is set so that only its lead (or a workspace admin) changes "
                    f"{PLAN_LINE_LEAD}. You can still {PLAN_LINE_EVERYONE}."
                ),
            },
            status=403,
        )
