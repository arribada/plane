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
from the path, and returning a response short-circuits the view.

WHICH REQUESTS HAVE A USER HERE, because the two guards below differ on it and
the difference is not cosmetic. Every APP API view (`/api/`) is
`BaseSessionAuthentication`, so `request.user` is already the user the view will
see — put there by `django.contrib.auth`'s middleware, above this one in the
list. Every API V1 view (`/api/v1/`) is `APIKeyAuthentication`, which DRF runs
inside `APIView.initial()` — after every `process_view` has returned. So a v1
request carrying only `X-Api-Key` reaches this hook as AnonymousUser, and any
check placed behind `is_authenticated` is INERT for it. The plan guard is a
question about a person and correctly waits for one; the external guard is a
question about a body and a project and correctly does not.

This module also carries `external_edits`, which is not about the plan at all —
it is here because it needs the same hook, on the same routes, before the same
views, and a second middleware doing the same three attribute reads would be
two places to keep one answer.
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

# The value of `external_source` that means "this write is the wiki sync's".
#
# One constant rather than a literal in three files: the middleware refuses on
# it, `test_plan_guard.py` asserts on it, and the wiki sends it. A string
# duplicated across a network boundary is a string that drifts on one side.
EXTERNAL_SOURCE = "arribada-wiki"

# The content types whose body this middleware will read to look for a
# declaration. Everything else — multipart above all — is left alone and NOT
# read: `request.body` on a multipart upload pulls the whole file into memory and
# can raise once the stream has been consumed, and the write paths that use it
# are asset uploads rather than work items.
_READABLE_TYPES = frozenset({"application/json", "application/x-www-form-urlencoded"})


def _declares_external_source(request):
    """Whether this request's body says `external_source: EXTERNAL_SOURCE`.

    FAILS OPEN, unlike `_body_keys` below, and the asymmetry is deliberate.
    `_body_keys` is consulted only after a project has opted IN to a restriction,
    so refusing an unreadable body costs one confused caller on one governed
    project. This runs on every write in the product, so treating "cannot read
    it" as "it is external" would refuse writes on every project that had not
    opted in — the exact opposite of the intended default.

    That is not a hole so much as the shape of the thing: a caller who omits the
    declaration has not made an external write, it has made an ordinary one, and
    an ordinary one is answered by the caller's ordinary permissions. See the
    model comment on `external_edits` — this governs a protocol both sides keep,
    not an adversary holding the key.

    The cheap check first: the substring scan over raw bytes rejects essentially
    every write in the product without parsing anything.
    """
    content_type = (request.content_type or "").split(";")[0].strip().lower()
    if content_type not in _READABLE_TYPES:
        return False
    try:
        body = request.body
    except Exception:
        # Stream already consumed, or larger than DATA_UPLOAD_MAX_MEMORY_SIZE.
        return False
    if not body or b"external_source" not in body:
        return False
    if content_type == "application/json":
        try:
            data = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            return False
        if not isinstance(data, dict):
            return False
        return data.get("external_source") == EXTERNAL_SOURCE
    return QueryDict(body).get("external_source") == EXTERNAL_SOURCE


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
    """Two refusals on one hook, because both need the request before the view.

    1. `external_edits` — a write whose body DECLARES `external_source` is
       refused unless this project has opted in. Every routed write that names a
       project, because the integration drives the same API a person does and
       there is no list of routes to narrow it to.
    2. `lead_only_edits` — an upstream PLAN write is refused unless the caller is
       the lead or a workspace admin. Only the nine routed handlers in `GUARDED`.

    They are separate settings answering separate questions and neither implies
    the other; see the model comments on both columns.

    COST on the writes that are neither. One `dict.get` on `view_kwargs`, then a
    content-type comparison, then a substring scan of the body — no parse, no
    query — for anything that is not JSON or form-encoded, and no read of the
    body at all for multipart. Query one is reached only by a body that actually
    names `external_source`; query two only by one of the nine handlers.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if request.method not in UNSAFE:
            return None
        project_id = view_kwargs.get("project_id")
        if not project_id:
            return None

        # THE EXTERNAL QUESTION IS ASKED FIRST, AND WITHOUT A USER. Both halves of
        # that are load-bearing, and getting either wrong makes this guard inert on
        # the one route it exists for.
        #
        # WITHOUT A USER, because the wiki writes to `/api/v1/`, which does NOT
        # authenticate from the session. `APIKeyAuthentication` runs inside
        # `APIView.initial()` — that is, when the view executes, which is AFTER
        # every `process_view` has returned. So for the sync's requests
        # `request.user` here is AnonymousUser, and a check ordered behind
        # `is_authenticated` (as the plan check below correctly is, because every
        # app API view authenticates from the session) would fall straight through
        # and refuse nothing at all, on precisely the traffic it was written for.
        #
        # It does not need one anyway: the subject is what the BODY DECLARES and
        # what the PROJECT ALLOWS. Neither is a fact about the caller.
        #
        # The cost of asking early is that an unauthenticated caller who already
        # knows a project's UUID can learn one boolean about it by sending a body
        # that declares itself external, and reads 403 where it would otherwise
        # read 401. That is the whole of the exposure, and it buys a guard that
        # works.
        if _declares_external_source(request):
            from .views import external_edits_allowed

            if not external_edits_allowed(project_id):
                return JsonResponse(
                    {
                        "error": "This project does not accept external edits.",
                        "detail": (
                            f"A write declaring external_source '{EXTERNAL_SOURCE}' was refused "
                            f"because this project has not turned on external edits. A project "
                            f"lead can enable them in the project's schedule settings. This is a "
                            f"separate setting from who may change the plan."
                        ),
                    },
                    status=403,
                )

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

        # THE PLAN QUESTION, about a person rather than a caller, and asked only
        # of the nine upstream handlers in `GUARDED`. The dict lookup costs
        # nothing on the writes that are not one of them.
        view_class = getattr(view_func, "cls", None) or getattr(view_func, "view_class", None)
        if view_class is None:
            return None
        rule = GUARDED.get((view_class.__name__, request.method), "unguarded")
        if rule == "unguarded":
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
