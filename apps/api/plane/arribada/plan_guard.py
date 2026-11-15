# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`lead_only_edits` and `allow_edit_others`, enforced on the routes this app does not own.

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
question about a person and correctly waits for one. Which is why it has a
SECOND DOOR: `refuse_plan_write`, called from `BaseAPIView.initial()` in
`plane/api/views/base.py` once `APIKeyAuthentication` has named the caller.
Any member can mint a personal API key (`ApiTokenEndpoint` has no role gate),
so a plan rule the public API did not enforce was a rule with a documented
bypass. Both doors ask `plan_write_refusal`, one table (`GUARDED`) names the
routes of both, and the external guard — a question about a body and a project
— correctly needs neither.

TWO RULES, ONE DECISION. `lead_only_edits` says WHO may change the plan: the
lead, or a workspace admin. `allow_edit_others` says WHOSE items a member may
change: with it off, a plan write is refused unless every work item the request
targets has the caller among its assignees — the lead and a workspace admin
excepted, as for the first rule. Until this module enforced it, the second
switch was honoured by the project gantt's drag grip alone, and the portfolio
view and the API let anyone move anyone's item. `TARGETS` says, per route,
which items a request changes.

This module also carries `external_edits`, which is not about the plan at all —
it is here because it needs the same hook, on the same routes, before the same
views, and a second middleware doing the same three attribute reads would be
two places to keep one answer.
"""

import json
import uuid

from django.http import JsonResponse, QueryDict

# The fields on an issue write that are THE PLAN rather than the work.
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
    # --- the app API (`/api/`), session-authenticated: the middleware answers.
    # The gantt bar drag and resize. Writes dates and nothing else.
    ("IssueBulkUpdateDateEndpoint", "POST"): None,
    # The date pickers, the parent picker, and every other property edit.
    ("IssueViewSet", "PATCH"): PLAN_FIELDS,
    # `put: update` is routed on the same URL as the PATCH and runs the same
    # serializer, so a PUT carrying a date was the PATCH guard with the method
    # changed.
    ("IssueViewSet", "PUT"): PLAN_FIELDS,
    # Creating an item that ARRIVES dated, parented, estimated or in a sprint is
    # writing the plan. An undated one is still anybody's to add: the body rule
    # keeps that true, and `CREATES` below keeps it true for the create modal.
    ("IssueViewSet", "POST"): PLAN_FIELDS,
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
    # --- the public API (`/api/v1/`), API-key authenticated: `refuse_plan_write`
    # answers from `BaseAPIView.initial()`, because the caller is still anonymous
    # when the middleware runs (see the module docstring). Same rules, same table.
    ("IssueListCreateAPIEndpoint", "POST"): PLAN_FIELDS,
    ("IssueDetailAPIEndpoint", "PATCH"): PLAN_FIELDS,
    ("IssueRelationListCreateAPIEndpoint", "POST"): None,
    ("CycleIssueListCreateAPIEndpoint", "POST"): None,
    ("CycleIssueDetailAPIEndpoint", "DELETE"): None,
    ("TransferCycleIssueAPIEndpoint", "POST"): None,
    ("ModuleIssueListCreateAPIEndpoint", "POST"): None,
    ("ModuleIssueDetailAPIEndpoint", "DELETE"): None,
}

# The routes that CREATE a work item. On these a plan field counts only when it
# carries a value. The create modal posts its WHOLE form, nulls included
# (`DEFAULT_WORK_ITEM_FORM_VALUES` has `start_date: null`, `parent_id: null`,
# `module_ids: null` and the rest), so a keys-only rule would refuse every
# member every new item on a governed project — the one thing both settings
# promise to leave alone. On an UPDATE a null is a change (clearing a date moves
# the plan), so there the keys decide, as they always have.
CREATES = frozenset({("IssueViewSet", "POST"), ("IssueListCreateAPIEndpoint", "POST")})

# Which work items a guarded request changes: what `allow_edit_others` is asked
# about. `kwargs` names URL arguments that hold a work item id; `body` names
# top-level body keys that hold one id, a list of ids, or a list of rows with an
# `id` (the bar drag's `updates`). A key that is absent contributes nothing — a
# viewset whose two actions read different keys lists both.
#
# REFUSE marks a route that touches every unfinished item of a sprint at once.
# There is no list of ids to check, and "every item somebody else is holding"
# is exactly what the switch says a member may not move; only the lead or an
# admin may, and they are excused before this table is read.
REFUSE = "refuse"
TARGETS = {
    ("IssueBulkUpdateDateEndpoint", "POST"): {"body": ("updates",)},
    ("IssueViewSet", "PATCH"): {"kwargs": ("pk",)},
    ("IssueViewSet", "PUT"): {"kwargs": ("pk",)},
    # A create carrying a parent is a plan write on the parent; one without is a
    # new item of the caller's own, and nobody else's item is touched.
    ("IssueViewSet", "POST"): {"body": ("parent_id", "parent")},
    ("SubIssuesEndpoint", "POST"): {"kwargs": ("issue_id",), "body": ("sub_issue_ids",)},
    # `create` sends `issues`; `remove_relation` sends `related_issue`.
    ("IssueRelationViewSet", "POST"): {"kwargs": ("issue_id",), "body": ("issues", "related_issue")},
    ("CycleIssueViewSet", "POST"): {"body": ("issues",)},
    ("CycleIssueViewSet", "DELETE"): {"kwargs": ("issue_id",)},
    ("TransferCycleIssueEndpoint", "POST"): REFUSE,
    # `create_module_issues` sends `issues`; `create_issue_modules` names the
    # item in the URL and sends `modules`.
    ("ModuleIssueViewSet", "POST"): {"kwargs": ("issue_id",), "body": ("issues",)},
    ("ModuleIssueViewSet", "DELETE"): {"kwargs": ("issue_id",)},
    # v1
    ("IssueListCreateAPIEndpoint", "POST"): {"body": ("parent", "parent_id")},
    ("IssueDetailAPIEndpoint", "PATCH"): {"kwargs": ("pk",)},
    ("IssueRelationListCreateAPIEndpoint", "POST"): {"kwargs": ("issue_id",), "body": ("issues",)},
    ("CycleIssueListCreateAPIEndpoint", "POST"): {"body": ("issues",)},
    ("CycleIssueDetailAPIEndpoint", "DELETE"): {"kwargs": ("issue_id",)},
    ("TransferCycleIssueAPIEndpoint", "POST"): REFUSE,
    ("ModuleIssueListCreateAPIEndpoint", "POST"): {"body": ("issues",)},
    ("ModuleIssueDetailAPIEndpoint", "DELETE"): {"kwargs": ("issue_id",)},
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

# The first sentence of the `allow_edit_others` refusal. A constant because the
# tests assert on it, and a 403 whose wording drifts from its test is a 403
# nobody can rely on reading the same way twice.
OWN_ITEMS_LINE = (
    "This project only lets a work item's own assignees change its dates, parent, "
    "estimate, sprint and module membership"
)


def _declares_external_source(request):
    """Whether this request's body says `external_source: EXTERNAL_SOURCE`.

    FAILS OPEN, unlike `_body_data` below, and the asymmetry is deliberate.
    `_body_data` is consulted only after a project has opted IN to a restriction,
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


def _flat(querydict):
    return {key: values[0] if len(values) == 1 else values for key, values in querydict.lists()}


def _body_data(request):
    """The request body as a dict, or None when it cannot be read.

    None means "cannot tell", and the caller treats that as a plan write on
    every item — FAIL CLOSED. It costs nothing in practice: this is only
    consulted on a project that has opted in, and only for a caller who is
    neither its lead nor a workspace admin, so the worst case is that somebody
    sending a body this cannot parse is refused rather than 400'd. A permission
    that fails open on a body it does not understand is a permission with a
    documented bypass.

    Two kinds of request arrive here. The middleware hands Django's own
    `HttpRequest`, before any view exists, and the bytes are read and parsed
    here. The v1 door hands DRF's `Request`, from inside the view's `initial()`:
    by then DRF owns the stream, so it is asked for `.data` and the parsers the
    view will read through are the ones that answer.
    """
    if hasattr(request, "_request"):
        try:
            data = request.data
        except Exception:
            return None
        if isinstance(data, QueryDict):
            return _flat(data)
        return dict(data) if isinstance(data, dict) else None

    content_type = (request.content_type or "").split(";")[0].strip().lower()
    try:
        body = request.body
    except Exception:
        # The stream was already consumed, or is too large to hold. Neither
        # happens on these routes; if it ever does, refuse rather than guess.
        return None
    if not body:
        return {}
    if content_type == "application/json":
        try:
            data = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            return None
        return data if isinstance(data, dict) else None
    if content_type == "application/x-www-form-urlencoded":
        # Django only fills `request.POST` for POST; PATCH has to be parsed.
        return _flat(QueryDict(body))
    return None


def _names_the_plan(data, rule, creating):
    """Whether a body touches one of `rule`'s fields — by key, or by value on a create."""
    named = set(data) & rule
    if not creating:
        return bool(named)
    return any(data.get(key) not in (None, "", []) for key in named)


def _ids_in(value):
    """Work-item ids held by one body value, or None when its shape is not one we read."""
    if value in (None, "", []):
        return set()
    if isinstance(value, (str, uuid.UUID)):
        return {str(value)}
    if isinstance(value, (list, tuple)):
        ids = set()
        for item in value:
            if isinstance(item, dict):
                item = item.get("id")
            if item in (None, ""):
                # A row with no id is a request the view would reject; refusing
                # it here is the same answer, reached without guessing.
                return None
            ids.add(str(item))
        return ids
    return None


def _targets(spec, data, view_kwargs):
    """The ids of the work items a request changes, or None when they cannot be read."""
    if spec == REFUSE:
        return None
    ids = set()
    for name in spec.get("kwargs", ()):
        value = view_kwargs.get(name)
        if value not in (None, ""):
            ids.add(str(value))
    if spec.get("body"):
        if data is None:
            return None
        for name in spec["body"]:
            found = _ids_in(data.get(name))
            if found is None:
                return None
            ids |= found
    for value in ids:
        try:
            uuid.UUID(value)
        except (TypeError, ValueError, AttributeError):
            return None
    return ids


def _all_assigned(ids, user):
    """Whether `user` is an assignee of EVERY one of `ids`.

    The explicit join, not `issue.assignees`: the M2M goes through
    `IssueAssignee`, which is soft-deleted, so a removed assignee would still
    count. A work item that does not exist, or lives in another project, has no
    row here and is refused — the view would have 404'd it, and a permission
    answer must not depend on the row existing.
    """
    from plane.db.models import IssueAssignee

    assigned = {
        str(issue_id)
        for issue_id in IssueAssignee.objects.filter(
            issue_id__in=ids, assignee_id=user.id, deleted_at__isnull=True
        ).values_list("issue_id", flat=True)
    }
    return ids <= assigned


def _lead_only_refusal():
    from .views import PLAN_LINE_EVERYONE, PLAN_LINE_LEAD

    return {
        "error": "Only the project lead can change the plan.",
        "detail": (
            f"This project is set so that only its lead (or a workspace admin) changes "
            f"{PLAN_LINE_LEAD}. You can still {PLAN_LINE_EVERYONE}."
        ),
    }


def _own_items_refusal(transfer=False):
    if transfer:
        tail = (
            ". Moving a sprint's unfinished items moves every one of them at once, so that is "
            "the lead's (or a workspace admin's) to do here."
        )
    else:
        tail = (
            ", and you are not assigned to every work item this request changes. Ask to be "
            "assigned, or ask the lead (or a workspace admin), who may change any item."
        )
    return {"error": "Only a work item's own assignees can change it here.", "detail": OWN_ITEMS_LINE + tail}


def plan_write_refusal(request, user, view_name, method, view_kwargs):
    """The 403 body for a plan write `user` may not make, or None when the view may run.

    ONE decision for both doors. The middleware wraps it in a `JsonResponse`;
    the v1 hook raises it as a `PermissionDenied`. Everything that decides is
    here, so the two cannot drift.

    In order: is this one of `GUARDED`'s routes at all; has the project asked
    for either rule (two one-row lookups, reached only on those routes); does the
    body even name the plan (the PLAN_FIELDS rule, value-aware on a create); is
    the caller the lead or a workspace admin, who both rules excuse; then
    `lead_only_edits`, which refuses everyone else outright; then
    `allow_edit_others`, which refuses unless every targeted item is the
    caller's own.

    `plan_edits_are_lead_only` and `_may_edit_plan` are asked BY NAME from
    `views.py`, so the answer here and the answer the schedule endpoint reports
    (`can_set_governance`, the arribada `_plan_guard`) are one answer.
    """
    key = (view_name, method)
    rule = GUARDED.get(key, "unguarded")
    if rule == "unguarded":
        return None
    project_id = view_kwargs.get("project_id")
    if not project_id:
        return None

    from .models import ProjectSchedule
    from .views import _may_edit_plan, plan_edits_are_lead_only

    lead_only = plan_edits_are_lead_only(project_id)
    # A project with no schedule row has never turned the switch off: the
    # column's default is True, and a row that does not exist cannot say False.
    own_only = ProjectSchedule.objects.filter(project_id=project_id, allow_edit_others=False).exists()
    if not lead_only and not own_only:
        return None

    data = _body_data(request)
    if rule is not None and data is not None and not _names_the_plan(data, rule, key in CREATES):
        return None
    if _may_edit_plan(user, project_id):
        return None
    if lead_only:
        return _lead_only_refusal()

    spec = TARGETS.get(key, REFUSE)
    targets = _targets(spec, data, view_kwargs)
    if targets is None:
        return _own_items_refusal(transfer=(spec == REFUSE))
    if targets and not _all_assigned(targets, user):
        return _own_items_refusal()
    return None


def refuse_plan_write(request, view):
    """The v1 door: the 403 body for this view's request, or None.

    Called from `BaseAPIView.initial()` in `plane/api/views/base.py`, after
    `super().initial()` has run `APIKeyAuthentication`, so `request.user` is the
    key's owner. `request` is DRF's `Request`; `view` the instance, whose class
    name and `kwargs` are what the table is keyed on.
    """
    if request.method not in UNSAFE:
        return None
    view_kwargs = getattr(view, "kwargs", None) or {}
    if not view_kwargs.get("project_id"):
        return None
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        # Not our refusal to make: `IsAuthenticated` has already answered 401.
        return None
    return plan_write_refusal(request, user, type(view).__name__, request.method, view_kwargs)


class PlanEditGuardMiddleware:
    """Two refusals on one hook, because both need the request before the view.

    1. `external_edits` — a write whose body DECLARES `external_source` is
       refused unless this project has opted in. Every routed write that names a
       project, because the integration drives the same API a person does and
       there is no list of routes to narrow it to.
    2. The plan — `lead_only_edits` and `allow_edit_others` — an upstream PLAN
       write is refused unless the caller may make it. Only the routed handlers
       in `GUARDED`, and only those on `/api/`: the `/api/v1/` entries are
       answered by `refuse_plan_write` from inside the view, because here their
       caller is still anonymous.

    They are separate settings answering separate questions and neither implies
    the other; see the model comments on the columns.

    COST on the writes that are neither. One `dict.get` on `view_kwargs`, then a
    content-type comparison, then a substring scan of the body — no parse, no
    query — for anything that is not JSON or form-encoded, and no read of the
    body at all for multipart. Query one is reached only by a body that actually
    names `external_source`; the plan's queries only by one of the handlers in
    `GUARDED`.
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
            # thing to debug. (A v1 request with an API key lands here too, and
            # is answered later by `refuse_plan_write`, once it has a user.)
            return None

        # THE PLAN QUESTION, about a person rather than a caller, and asked only
        # of the upstream handlers in `GUARDED`. The dict lookup inside costs
        # nothing on the writes that are not one of them.
        view_class = getattr(view_func, "cls", None) or getattr(view_func, "view_class", None)
        if view_class is None:
            return None
        body = plan_write_refusal(request, user, view_class.__name__, request.method, view_kwargs)
        if body is None:
            return None
        return JsonResponse(body, status=403)
