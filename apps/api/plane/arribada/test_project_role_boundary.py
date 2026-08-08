# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A route that names a project decides on the caller's role IN THAT PROJECT.

`allow_permission(..., level="WORKSPACE")` tests the caller's WORKSPACE role.
Every endpoint in this app then scopes itself with `_visible_projects`, which
asks only "is this person on the project at all" — a question a GUEST answers
yes to. So one person walked through everything: workspace MEMBER, project
GUEST. The funder given an ordinary seat because they also work here. Anybody
put on a project as a guest, which is usually done precisely because that is the
project they are not supposed to steer.

The money fix (d0506338a8, b38b65caef) closed four endpoints and argued the rest
were safe "while the role list is VIEWER_ROLES, because all three roles are on it
and the role question has no answer to get wrong". That is true of READS. Every
write here sits on `[ROLE.ADMIN, ROLE.MEMBER]`, where the question does have an
answer to get wrong, and roughly thirty of them were getting it wrong: a project
guest could rewrite every date in the project, delete the baseline recording what
was promised to a funder, replace the roster, and inflate the person-days the
printed cost annex multiplies by an hourly rate.

WHY THIS FILE WALKS THE URLCONF. `test_money_permissions.py` enumerated four
routes by hand and was green the whole time five holes were open — including one
on the budget itself, reachable through PATCH /schedule/, because the list had
been written from the URLs with "budget" in them. A list somebody maintains is a
list somebody forgets. Everything below is generated from `urlpatterns`, so an
endpoint added next month is under the rule before anyone has thought about it.

Three assertions, and the last two are why this is not just a linter:

  structural  every handler on a project route is decorated level="PROJECT"
  denial      a project GUEST is refused every handler whose roles exclude GUEST
  service     a project GUEST still gets every handler whose roles include GUEST,
              and a project MEMBER is never refused one that includes MEMBER

Without the last, `MONEY_ROLES = []` — or a decorator "hardened" to refuse
everybody — would pass the first two perfectly while taking the tool away from
the people who use it.

Needs a database: the rule lives in a decorator that queries WorkspaceMember and
ProjectMember, and the point is to make real requests through it.
"""

import re
import uuid

import pytest
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.urls import urlpatterns
from plane.db.models import Issue, Project, ProjectMember, User, Workspace, WorkspaceMember

METHODS = ("get", "post", "patch", "put", "delete")

# Handlers that legitimately answer a caller their role list excludes with
# something other than 403, keyed "ViewName.method" -> the status they answer.
# Empty on purpose: nothing qualifies today, and adding an entry should take an
# argument rather than a shrug.
EXPECTED_OTHER: dict[str, int] = {}

# Handlers a project MEMBER is legitimately refused, and why.
#
# The decorator is the outer question and MEMBER is on every one of these role
# lists. Each then asks a SECOND one inside the view — `_lead_guard`, or
# `_may_publish` — and that one is about a JOB rather than a role: anyone on the
# project raises a purchase request, the lead approves it and signs the sheet it
# lands on; anyone can read the plan, the lead decides whether it goes on the
# public internet. Both predate this change and neither is a role the decorator
# could express.
#
# NOT A MUTE. The sweep still calls them, and the test below it proves the LEAD
# is served every one — so an entry here cannot be used to quietly excuse a
# handler that has simply stopped working for everybody.
LEAD_ONLY = {
    "ProjectExpensesEndpoint.post": "the expense sheet is the record of what was committed",
    "ProjectExpenseDetailEndpoint.patch": "the same sheet, one line of it",
    "ProjectExpenseDetailEndpoint.delete": "the same sheet, one line of it",
    "ProjectProcurementDecisionEndpoint.post": "approving a purchase is the act that spends",
    "ProjectPublicTimelineEndpoint.post": "publishing a schedule to the open internet",
    "ProjectPublicTimelineEndpoint.delete": "revoking the anchor somebody was given",
}


def _permission_of(func):
    """The `allowed_roles` and `level` a handler was decorated with, or None.

    Read out of `allow_permission`'s closure rather than reparsed from the
    source. The decorator keeps both in cells on `_wrapped_view`, and
    `functools.wraps` does not copy `__code__`, so `co_freevars` still describes
    the wrapper. That means this reads what will actually run at request time —
    a decorator applied through an alias, a helper or a loop is still caught,
    where a grep for the literal string `level="PROJECT"` would not be.
    """
    code = getattr(func, "__code__", None)
    if code is None or "allowed_roles" not in code.co_freevars:
        return None
    cells = dict(zip(code.co_freevars, func.__closure__ or ()))
    return {
        "allowed_roles": cells["allowed_roles"].cell_contents,
        "level": cells["level"].cell_contents,
    }


def _handlers(cls):
    """The HTTP methods this view class actually implements, ours only.

    Walked over the MRO but restricted to classes defined in this module, so
    DRF's own `options` and upstream's BaseAPIView helpers are not mistaken for
    endpoints we are meant to have decorated.
    """
    found = {}
    for klass in reversed(cls.__mro__):
        if getattr(klass, "__module__", "") != "plane.arribada.views":
            continue
        for name, attr in vars(klass).items():
            if name in METHODS and callable(attr):
                found[name] = attr
    return found


def _project_routes():
    """(route, class, method, permission) for every handler on a project route."""
    out = []
    for entry in urlpatterns:
        route = str(entry.pattern)
        if "<uuid:project_id>" not in route:
            continue
        cls = getattr(entry.callback, "cls", None) or getattr(entry.callback, "view_class", None)
        if cls is None:
            continue
        for method, func in _handlers(cls).items():
            out.append((route, cls.__name__, method, _permission_of(func)))
    return out


ROUTES = _project_routes()
IDS = [f"{name}.{method}" for _route, name, method, _perm in ROUTES]

# The two halves of the behavioural sweep, split by what the decorator says
# rather than by a list anybody keeps.
GUEST_MUST_BE_REFUSED = [r for r in ROUTES if r[3] and ROLE.GUEST not in r[3]["allowed_roles"]]
GUEST_MUST_BE_SERVED = [r for r in ROUTES if r[3] and ROLE.GUEST in r[3]["allowed_roles"]]
MEMBER_MUST_BE_SERVED = [r for r in ROUTES if r[3] and ROLE.MEMBER in r[3]["allowed_roles"]]

REFUSED_IDS = [f"{n}.{m}" for _r, n, m, _p in GUEST_MUST_BE_REFUSED]
SERVED_IDS = [f"{n}.{m}" for _r, n, m, _p in GUEST_MUST_BE_SERVED]


def test_the_walk_actually_found_the_routes():
    """A guard on the guard.

    If the URLconf is ever restructured — an include(), a router — the walk would
    find nothing, every test below would sweep an empty list, and the file would
    go on passing while asserting nothing at all. That is worse than not existing.
    Sixty-nine handlers across forty-two views today; the floor is what matters,
    not the exact number.
    """
    assert len(ROUTES) >= 65, IDS
    assert len(GUEST_MUST_BE_REFUSED) >= 30, REFUSED_IDS
    assert len(GUEST_MUST_BE_SERVED) >= 20, SERVED_IDS


@pytest.mark.parametrize("route,name,method,perm", ROUTES, ids=IDS)
def test_a_project_route_decides_on_the_project_role(route, name, method, perm):
    """The structural half. No database, no request — just the wiring.

    This is the assertion that covers the endpoint nobody has written yet: it
    fails on the first handler that ships at level="WORKSPACE" on a URL with a
    project in it, whether or not anybody thought to write a case for it. The
    behavioural sweeps below prove the rule does what it claims; this one is what
    makes it a rule rather than thirty coincidences.
    """
    assert perm is not None, (
        f"{name}.{method} handles {route} with no allow_permission at all. "
        "Every handler on a project route is decorated; an undecorated one is "
        "reachable by anyone with a session."
    )
    assert perm["level"] == "PROJECT", (
        f'{name}.{method} on {route} is decorated level="{perm["level"]}", which tests the '
        "caller's WORKSPACE role. The URL names a project, so the role that decides is the "
        'role they hold ON THAT PROJECT: level="PROJECT". Upstream\'s decorator keeps the '
        "workspace-admin fall-through, so an admin on the project is not locked out — see "
        "plane/app/permissions/base.py."
    )


@pytest.fixture
def world(db):
    """One workspace, one project, one work item, and the four callers that matter.

    Everything except the roles is identical between them, so a difference in the
    answer can only be a role.

        label                     workspace   project
        member                    MEMBER      MEMBER
        guest                     GUEST       GUEST
        ws_member_project_guest   MEMBER      GUEST      <- the hole
        ws_admin_project_guest    ADMIN       GUEST      <- the fall-through
    """
    # No passwords: `force_authenticate` bypasses password checking, and the PBKDF2
    # default is expensive enough that five users a fixture dominated the run.
    owner = User.objects.create(email="boundary-owner@plane.so", username="boundary-owner")
    workspace = Workspace.objects.create(name="Boundary WS", owner=owner, slug="boundary-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(
        name="Boundary", workspace=workspace, created_by=owner, identifier="BND"
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
    )
    issue = Issue.objects.create(
        project=project, workspace=workspace, name="A work item", created_by=owner
    )

    clients = {}
    for label, ws_role, project_role in (
        ("member", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("guest", ROLE.GUEST.value, ROLE.GUEST.value),
        ("ws_member_project_guest", ROLE.MEMBER.value, ROLE.GUEST.value),
        ("ws_admin_project_guest", ROLE.ADMIN.value, ROLE.GUEST.value),
    ):
        user = User.objects.create(email=f"boundary-{label}@plane.so", username=f"boundary-{label}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=ws_role)
        ProjectMember.objects.create(
            project=project, workspace=workspace, member=user, role=project_role
        )
        client = APIClient()
        client.force_authenticate(user=user)
        clients[label] = client

    return {"clients": clients, "slug": workspace.slug, "project": project, "issue": issue}


def _url(route, world):
    """The route with its placeholders filled in.

    Ids other than the project and the work item — an order, an expense, a
    purchase request — are random on purpose. The decorator runs before the view
    looks anything up, so a permission answer must not depend on the row
    existing; if one of these ever returns 404 to a caller who should have been
    refused, that 404 is itself the leak (it says the row is not there).
    """
    url = (
        route.replace("<str:slug>", world["slug"])
        .replace("<uuid:project_id>", str(world["project"].id))
        .replace("<uuid:issue_id>", str(world["issue"].id))
    )
    return "/api/arribada/" + re.sub(r"<[^>]+>", lambda _m: str(uuid.uuid4()), url)


def _sweep(client, handlers, world):
    """Call every handler once and return {"View.method": status}.

    One pass, one fixture. Parametrizing these would name each offending route on
    its own line in a CI log, which is nicer, and would also build the whole cast
    of callers — four users, a workspace, a project, five memberships — once per
    route, a hundred and twenty times a run. Measured at roughly ten seconds
    apiece here, which is half an hour of setup to make a hundred and twenty
    one-line assertions, on a job that has to stay cheap enough that nobody is
    tempted to skip it. The assertions below print every offender in the failure
    message instead, so nothing is lost but the line breaks.

    An empty body on purpose. The role has to be settled before anything in the
    payload is looked at, so a handler that validates its body first and answers
    400 to somebody it should have refused has already done work for them.
    """
    answers = {}
    for route, name, method, _perm in handlers:
        response = getattr(client, method)(_url(route, world), {}, format="json")
        answers[f"{name}.{method}"] = response.status_code
    return answers


def test_a_project_guest_is_refused_everything_guests_are_not_on_the_list_for(world):
    """The hole, swept over every write in the app at once.

    The caller is a workspace MEMBER and a project GUEST — the combination the
    client hides these surfaces from and the server served. Thirty-odd handlers
    let them rewrite every date in the project, delete the baseline recording what
    was promised to a funder, replace the roster, and move the person-days the
    cost annex multiplies by an hourly rate.
    """
    answers = _sweep(world["clients"]["ws_member_project_guest"], GUEST_MUST_BE_REFUSED, world)
    served = {
        key: code for key, code in answers.items() if code != EXPECTED_OTHER.get(key, 403)
    }
    assert not served, (
        f"a project GUEST holding a workspace MEMBER seat was not refused: {served}. "
        'Each of these is decorated with a role list that excludes GUEST, so at level="PROJECT" '
        "the answer must be 403 — anything else means the role being tested is not the one they "
        "hold on this project."
    )


def test_a_project_guest_still_reads_everything_guests_read(world):
    """The half that is easy to lose, and the reason the reads moved too.

    Putting every project route on level="PROJECT" changes what a workspace admin
    who is NOT on the project gets — 403 rather than the 404 `_visible_projects`
    already gave them — and it must change nothing whatever for the guest that the
    schedule, the deliverables and the work items are meant to answer. A funder
    left with a login and nothing to read is the failure mode of every fix in this
    area, so it is asserted rather than assumed.
    """
    answers = _sweep(world["clients"]["guest"], GUEST_MUST_BE_SERVED, world)
    refused = {key: code for key, code in answers.items() if code == 403}
    assert not refused, (
        f"a project GUEST was refused surfaces their role list includes them on: {refused}. "
        "This is what a funder or a partner was invited to follow."
    )


def test_a_project_member_is_never_refused_their_own_project(world):
    """And the same for the people who actually run the project.

    Read as "not 403" rather than as a success code: the bodies are empty, so most
    of these answer 400 or 404, and that is fine — those are the view talking
    about the payload, which means the permission let them through. 403 is the
    only answer that says the fix went too far.
    """
    answers = _sweep(world["clients"]["member"], MEMBER_MUST_BE_SERVED, world)
    refused = {
        key: code for key, code in answers.items() if code == 403 and key not in LEAD_ONLY
    }
    assert not refused, (
        f"a project MEMBER was refused handlers whose role list includes MEMBER: {refused}. "
        "The fix has closed the tool for the team it was written for. If one of these is "
        "genuinely a lead's job rather than a member's, it belongs in LEAD_ONLY with the "
        "reason — and the test below will then hold it to being reachable by the lead."
    )
    # The other direction on the same list: an entry that has stopped being
    # refused is an entry that has stopped meaning anything, and leaving it there
    # would excuse the next handler that regresses into it.
    no_longer = {key for key in LEAD_ONLY if key in answers and answers[key] != 403}
    assert not no_longer, (
        f"LEAD_ONLY names handlers that no longer refuse a plain member: {sorted(no_longer)}. "
        "Either the guard was dropped or the entry is stale."
    )


def test_the_lead_still_passes_the_guard_that_refuses_a_member(world):
    """The half that makes LEAD_ONLY an assertion instead of an exception list.

    Every entry above is excused from the member sweep, so without this an
    endpoint that had broken outright — 403 to everybody — would sit in that list
    looking like policy. The caller here is a workspace ADMIN who is only a GUEST
    on the project, which is the person `_is_project_lead` admits while the
    project has no lead of its own: somebody has to be able to unblock a purchase
    on a project nobody owns yet, and it is the one case where admin and lead
    coincide. It also exercises the decorator's workspace-admin fall-through,
    since their PROJECT role would not pass any of these role lists on its own.
    """
    lead_only = [r for r in MEMBER_MUST_BE_SERVED if f"{r[1]}.{r[2]}" in LEAD_ONLY]
    assert len(lead_only) == len(LEAD_ONLY), (
        f"LEAD_ONLY has entries that are not routed handlers: "
        f"{sorted(set(LEAD_ONLY) - {f'{r[1]}.{r[2]}' for r in lead_only})}"
    )
    answers = _sweep(world["clients"]["ws_admin_project_guest"], lead_only, world)
    refused = {key: code for key, code in answers.items() if code == 403}
    assert not refused, (
        f"the lead of a leaderless project was refused their own guard: {refused}. "
        "These are excused from the member sweep on the grounds that the LEAD can reach "
        "them; if nobody can, they are broken rather than protected."
    )


def test_a_workspace_admin_keeps_the_fall_through_on_a_project_they_only_guest(world):
    """level="PROJECT" must not lock the person who runs the organisation out.

    Upstream's `allow_permission` falls through to a second branch admitting a
    workspace ADMIN whatever their project role, provided they are on the
    project. That fall-through is the reason this rule is safe to apply to
    thirty write endpoints at once, and a hand-rolled guard reading only
    ProjectMember.role would pass every other test in this file.
    """
    url = _url(
        "workspaces/<str:slug>/projects/<uuid:project_id>/schedule/", world
    )
    assert world["clients"]["ws_admin_project_guest"].get(url).status_code == 200


def test_an_admin_outside_the_project_is_refused_by_scope_not_by_role(db):
    """The cost of the change, named rather than discovered.

    A workspace admin with no ProjectMember row was already refused everything
    here — `_visible_projects` answered them 404 long before any of this. Moving
    to level="PROJECT" changes the number to 403 and nothing else. Asserted as
    "refused" across both codes because they are the same event seen from two
    lines of the same function, and the point is that nobody who was being served
    stops being served.
    """
    owner = User.objects.create(email="outsider-owner@plane.so", username="outsider-owner")
    workspace = Workspace.objects.create(name="Outsider WS", owner=owner, slug="outsider-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(
        name="Theirs", workspace=workspace, created_by=owner, identifier="THRS"
    )

    outsider = User.objects.create(email="outsider@plane.so", username="outsider")
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=ROLE.ADMIN.value)
    client = APIClient()
    client.force_authenticate(user=outsider)

    url = f"/api/arribada/workspaces/{workspace.slug}/projects/{project.id}/overview/"
    assert client.get(url).status_code in (403, 404)
