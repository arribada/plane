# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`lead_only_edits`: the plan is the lead's, the work is everyone's.

WHY THIS FILE LOOKS LIKE `test_project_role_boundary.py`. That file exists
because `test_money_permissions.py` enumerated four routes by hand and was green
the whole time five holes were open. The same trap is open here and it is worse,
because this setting's promise is a NEGATIVE — "a member cannot change a date" —
and a hand-written list of the places a date can be changed is a list somebody
forgets. So the sweep below is generated from `urlpatterns`, and a write handler
that is neither guarded nor named in `DAY_TO_DAY` fails the run.

BOTH DIRECTIONS, because this fork has been bitten by the other kind:

  refused   with the switch on, a plain MEMBER is refused every guarded write
  served    with the switch on, the LEAD is refused none of them
  unchanged with the switch OFF — every project in production today — the
            member is refused nothing

Without the second, `_plan_guard` could `return Response(403)` unconditionally
and pass the first perfectly while taking the timeline away from everybody.
Without the third, a default that quietly governed every existing project would
ship green.

THE LINE ITSELF is asserted rather than described: the state of a work item, a
comment, a checklist tick and an ACTUAL effort survive the switch; a date, an
ESTIMATE, a discipline, a parent, a dependency and sprint membership do not.
That distinction is the product, so it is pinned at the level a user meets it.

AND THE UPSTREAM HALF. Most of the plan is not written through this app: the
gantt's bar drag posts to upstream's `IssueBulkUpdateDateEndpoint`, and parents,
dependencies and sprint membership are upstream viewsets. Those are covered by
`plane/arribada/plan_guard.py`'s middleware, and the tests at the bottom of this
file are the only thing standing between that middleware and an upstream rename
turning it into decoration.

Needs a database.
"""

import re
import uuid

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.models import ProjectSchedule, ProjectTeamMember
from plane.arribada.plan_guard import GUARDED
from plane.arribada.urls import urlpatterns
from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember

WRITE_METHODS = ("post", "patch", "put", "delete")


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    """Upstream's issue handlers publish to Celery on the SUCCESS path.

    Nothing in this file is about the activity feed, and CI has Postgres but no
    RabbitMQ — so a `.delay()` on the way out would turn "the lead was served"
    into a broker timeout and, worse, into a 500 that an assertion written as
    "not 403" would happily accept. Stubbed at the three modules that hold the
    imported name, because patching the task object itself would not reach a
    `from ... import issue_activity` that has already run.
    """
    for module in (
        "plane.app.views.issue.base",
        "plane.app.views.issue.sub_issue",
        "plane.app.views.issue.relation",
    ):
        try:
            target = __import__(module, fromlist=["issue_activity"])
        except ImportError:  # pragma: no cover - upstream moved a module
            continue
        if hasattr(target, "issue_activity"):
            monkeypatch.setattr(target.issue_activity, "delay", lambda *a, **k: None)
        for extra in ("model_activity", "issue_description_version_task", "recent_visited_task"):
            if hasattr(target, extra):
                monkeypatch.setattr(getattr(target, extra), "delay", lambda *a, **k: None)


# Write handlers on a project route that a member KEEPS when the plan is the
# lead's, and why. This is the setting's promise written as an assertion: every
# entry here is something the help text says an ordinary member can still do.
#
# An addition to this dict has to be an argument, not a shrug — it is the only
# way a new endpoint escapes the guard, and the sweep prints the offender.
DAY_TO_DAY = {
    "IssueChecklistEndpoint.post": "ticking and adding checklist items is doing the work",
    "IssueChecklistEndpoint.delete": "the same list, one line of it",
    "ProjectStatusEndpoint.post": "a status update is a report, not a change to the plan",
    "IssueArtifactsEndpoint.post": "attaching evidence to an item you are working on",
    "IssueArtifactsEndpoint.delete": "the same links",
    "ProjectWikiDocEndpoint.put": (
        "where the documentation lives — a wiki page, a Drive folder, a repo. "
        "Nothing here says when work happens or how big it is"
    ),
    "ProjectProcurementEndpoint.post": (
        "anyone on the project raises a purchase request; the lead approves it, "
        "and that approval is already `_lead_guard`'s"
    ),
    "ProjectProcurementDecisionEndpoint.patch": "editing a request that has not been decided",
    "ProjectProcurementDecisionEndpoint.delete": "withdrawing one",
    "ProjectTeamEndpoint.put": (
        "the roster is not the plan, and REMOVALS from it are already the lead's "
        "by a guard inside the handler"
    ),
    "ProjectScheduleEndpoint.patch": (
        "CONDITIONAL ON THE PAYLOAD: only refused when the body names a plan "
        "field, so an empty sweep body is correctly let through. Asserted by "
        "name below with a real date in it"
    ),
    "GithubSyncNowEndpoint.post": "pulling issues from GitHub into the inbox files nothing",
    "ProjectAiDraftEndpoint.post": "the assistant PROPOSES; applying is guarded",
    "ProjectAiDraftItemEndpoint.post": "proposes",
    "ProjectAiPlanEndpoint.post": "proposes",
    "ProjectSetupPlanEndpoint.post": "proposes",
    "ProjectAiSprintTasksEndpoint.post": "proposes",
    "ProjectIssueOrdersEndpoint.post": (
        "a saved arrangement of the rows is a way of LOOKING at the plan, not a "
        "change to what it says; no date, size, owner or dependency moves"
    ),
    "ProjectIssueOrderDetailEndpoint.post": "restores an arrangement; see above",
    "ProjectIssueOrderDetailEndpoint.delete": "forgets an arrangement",
    "ProjectIssueOrderApplyEndpoint.post": "applies an arrangement",
    "ProjectTemplateCloneEndpoint.post": (
        "creates a NEW project from this one as a template; it does not touch "
        "this project's plan"
    ),
}

# Handlers that refuse a plain member whether or not this setting exists.
#
# These are `_lead_guard`'s, and they predate all of this — the same six that
# `test_project_role_boundary.py` carries as LEAD_ONLY, for the same reasons
# (spending money, and publishing a schedule to the open internet). They are
# excluded from the sweeps below because a 403 here says nothing about
# `lead_only_edits`, and asserting on them would make this file fail the day
# somebody changed the expense sheet.
#
# NOT A HOLE: they refuse MORE than this setting does, never less. And the list
# is checked against reality — `test_the_already_lead_only_list_is_not_stale`
# fails if one of them stops refusing.
ALREADY_LEAD_ONLY = {
    "ProjectExpensesEndpoint.post",
    "ProjectExpenseDetailEndpoint.patch",
    "ProjectExpenseDetailEndpoint.delete",
    "ProjectProcurementDecisionEndpoint.post",
    "ProjectPublicTimelineEndpoint.post",
    "ProjectPublicTimelineEndpoint.delete",
}

# Writes that were ALREADY restricted before `lead_only_edits` existed, by a rule
# on a different axis from it — a project ROLE rather than leadership.
#
# `ProjectCleanEndpoint.post` empties a project, and it carries
# `@allow_permission(allowed_roles=[ROLE.ADMIN], level="PROJECT")`. The decorator
# answers before `_plan_guard` is ever reached, so it refuses a plain member with
# the setting OFF — which is the state every project in production is in — and it
# refuses the lead too, because being a project's lead is not the same as being
# its administrator. Neither refusal is this setting's doing, and neither is a
# regression; the sweep simply had no name for "restricted for a reason that
# predates us".
#
# Kept separate from ALREADY_LEAD_ONLY rather than folded into it: that set means
# "the lead may, others may not", and this one means "not even the lead", which is
# a different promise and would be a different bug if it changed.
ALREADY_ADMIN_ONLY = {
    "ProjectCleanEndpoint.post",
}


def _project_write_routes():
    """(route, class name, method) for every write handler on a project route."""
    out = []
    for entry in urlpatterns:
        route = str(entry.pattern)
        if "<uuid:project_id>" not in route:
            continue
        cls = getattr(entry.callback, "cls", None) or getattr(entry.callback, "view_class", None)
        if cls is None:
            continue
        for klass in reversed(cls.__mro__):
            if getattr(klass, "__module__", "") != "plane.arribada.views":
                continue
            for name in vars(klass):
                if name in WRITE_METHODS and (route, cls.__name__, name) not in out:
                    out.append((route, cls.__name__, name))
    return out


WRITE_ROUTES = _project_write_routes()
WRITE_IDS = [f"{name}.{method}" for _route, name, method in WRITE_ROUTES]


def test_the_walk_actually_found_the_write_routes():
    """A guard on the guard, for the same reason the boundary file has one.

    If the URLconf is restructured the walk finds nothing, every sweep below
    iterates an empty list, and this file passes while asserting that no
    endpoint anywhere is guarded. Thirty-odd write handlers today.
    """
    assert len(WRITE_ROUTES) >= 30, WRITE_IDS


@pytest.fixture
def governed(db):
    """A project whose plan is the lead's, and the three callers that matter.

    `lead` holds the arribada roster's `is_lead` — the fork's own idea of a lead,
    which exists because most of the team has no Plane account. `member` is an
    ordinary project MEMBER, the person the setting is about. `ws_admin` is a
    workspace ADMIN who is only a project GUEST: the repair path.

    `force_login` rather than `force_authenticate`, because the middleware that
    covers upstream's routes runs BEFORE a DRF view exists and reads the session
    user. (It also honours `_force_auth_user`, so either would work — but a test
    that authenticates the way production does is the one worth having.)
    """
    owner = User.objects.create(email="pg-owner@arribada.test", username="pg-owner")
    workspace = Workspace.objects.create(name="Plan Guard", owner=owner, slug="plan-guard-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(
        name="Governed", workspace=workspace, created_by=owner, identifier="GOV"
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
    )
    state = State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    other_state = State.objects.create(
        name="In progress", project=project, workspace=workspace, group="started", sequence=2
    )
    issue = Issue.objects.create(
        name="Radio bring-up",
        project=project,
        workspace=workspace,
        state=state,
        created_by=owner,
    )

    people, clients = {}, {}
    for label, ws_role, project_role in (
        ("lead", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("member", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("ws_admin", ROLE.ADMIN.value, ROLE.GUEST.value),
    ):
        user = User.objects.create(email=f"pg-{label}@arribada.test", username=f"pg-{label}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=ws_role)
        ProjectMember.objects.create(
            project=project, workspace=workspace, member=user, role=project_role
        )
        people[label] = user
        client = APIClient()
        client.force_login(user)
        client.force_authenticate(user=user)
        clients[label] = client

    ProjectTeamMember.objects.create(
        project=project,
        name="Lead",
        email="pg-lead@arribada.test",
        member=people["lead"],
        is_lead=True,
    )
    ProjectSchedule.objects.create(project=project, lead_only_edits=True)

    return {
        "workspace": workspace,
        "project": project,
        "project_id": str(project.id),
        "slug": workspace.slug,
        "issue": issue,
        "state": state,
        "other_state": other_state,
        "users": people,
        "clients": clients,
    }


def _open_up(world):
    """Turn the setting off again — the state every project in production is in."""
    ProjectSchedule.objects.filter(project=world["project"]).update(lead_only_edits=False)


def _url(route, world):
    """The arribada route with its placeholders filled in.

    Ids other than the project and the work item are random: the guard runs
    before the view looks a row up, so a permission answer must not depend on
    that row existing.
    """
    url = (
        route.replace("<str:slug>", world["slug"])
        .replace("<uuid:project_id>", world["project_id"])
        .replace("<uuid:issue_id>", str(world["issue"].id))
    )
    return "/api/arribada/" + re.sub(r"<[^>]+>", lambda _m: str(uuid.uuid4()), url)


def _sweep(client, world):
    """Call every project write handler once with an empty body. {"View.method": status}."""
    answers = {}
    for route, name, method in WRITE_ROUTES:
        response = getattr(client, method)(_url(route, world), {}, format="json")
        answers[f"{name}.{method}"] = response.status_code
    return answers


def test_a_member_is_refused_every_plan_write(governed):
    """The promise, swept over the whole app at once.

    Anything not refused has to be in `DAY_TO_DAY` with a reason, so the endpoint
    somebody adds next month is under the rule before anyone has thought about it.
    """
    answers = _sweep(governed["clients"]["member"], governed)
    escaped = {
        key: code
        for key, code in answers.items()
        if code != 403 and key not in DAY_TO_DAY and key not in ALREADY_LEAD_ONLY
    }
    assert not escaped, (
        f"a plain project MEMBER was NOT refused these writes on a project whose plan is the "
        f"lead's: {escaped}. Each one either needs `_plan_guard` at the top of the handler, or "
        f"an entry in DAY_TO_DAY saying why it is part of doing the work rather than part of "
        f"deciding the plan."
    )
    # The other direction on the same list: an entry that has started refusing is
    # an entry that is now a lie in the help text.
    broke = {key for key in DAY_TO_DAY if answers.get(key) == 403}
    assert not broke, (
        f"DAY_TO_DAY names writes that a member is now refused: {sorted(broke)}. The setting's "
        f"help text promises these still work, so either the guard has spread too far or the "
        f"help text is wrong."
    )


def test_the_already_lead_only_list_is_not_stale(governed):
    """An excuse list that has stopped being true is an excuse list that hides things.

    Every name in `ALREADY_LEAD_ONLY` is excused from the sweep above on the
    grounds that `_lead_guard` refuses a member there anyway. If one of them
    stops refusing, the exemption is silently covering an unguarded write.
    """
    answers = _sweep(governed["clients"]["member"], governed)
    stale = {key for key in ALREADY_LEAD_ONLY if answers.get(key) != 403}
    assert not stale, (
        f"ALREADY_LEAD_ONLY names handlers that no longer refuse a plain member: {sorted(stale)}. "
        f"Either `_lead_guard` was dropped from them or the entry is out of date — and either "
        f"way the sweep above is now excusing something."
    )


def test_the_lead_is_refused_none_of_them(governed):
    """The half without which a guard that refuses EVERYBODY would pass.

    Read as "not 403": the bodies are empty, so most of these answer 400 or 404,
    and that is the view talking about the payload — which means the permission
    let them through.
    """
    answers = _sweep(governed["clients"]["lead"], governed)
    refused = {
        key: code
        for key, code in answers.items()
        # Restricted by a rule that predates this setting and does not admit the
        # lead either — emptying a project is the project ADMIN's, and publishing a
        # public timeline has its own guard. Excusing them here is not weakening
        # the check: `test_the_already_lead_only_list_is_not_stale` asserts every
        # name on both lists is still a real routed handler, so an entry cannot rot
        # into a blanket excuse.
        if code == 403 and key not in ALREADY_ADMIN_ONLY and key not in ALREADY_LEAD_ONLY
    }
    assert not refused, (
        f"the project LEAD was refused writes on their own project: {refused}. This setting "
        f"names them as the person who may; if nobody may, it is broken rather than protecting "
        f"anything."
    )


def test_a_workspace_admin_keeps_the_repair_path(governed):
    """The plan needs a way to be fixed when the lead is away.

    Deliberately different from `_lead_guard`, which refuses an admin on a
    project that HAS a lead — approving spend must be attributable to the budget
    owner. A wrong date is not spending, and a permission whose only remedy is to
    switch the permission off protects nothing. The caller here is a project
    GUEST, so nothing but their workspace role can be admitting them.
    """
    answers = _sweep(governed["clients"]["ws_admin"], governed)
    refused = {
        key: code
        for key, code in answers.items()
        # `_lead_guard` refuses them here and is MEANT to: approving spend has to
        # be attributable to the person who owns the budget. That is the boundary
        # this guard deliberately draws differently, not an inconsistency.
        if code == 403 and key not in ALREADY_LEAD_ONLY
    }
    assert not refused, f"the workspace admin was locked out of the plan: {refused}"


def test_with_the_setting_off_nothing_changes_for_a_member(governed):
    """Every project in production is in this state, and must stay exactly as it was."""
    _open_up(governed)
    answers = _sweep(governed["clients"]["member"], governed)
    refused = {
        key: code
        for key, code in answers.items()
        # The pre-existing lead-only guards are not this setting's doing and go on
        # refusing regardless — see LEAD_ONLY in test_project_role_boundary.py.
        # Same for the project-ADMIN-only writes: with the setting off the
        # middleware returns before it queries anything, so a 403 here can only be
        # the endpoint's own decorator, which has refused a plain member since long
        # before this feature.
        if code == 403 and key not in ALREADY_LEAD_ONLY and key not in ALREADY_ADMIN_ONLY
    }
    assert not refused, (
        f"a member was refused writes on a project that has NOT turned the setting on: "
        f"{refused}. The default is off, and off has to mean the product behaves as it did."
    )


# --- the line, at the level a person meets it --------------------------------


def _arribada(world, name, **kwargs):
    return reverse(name, kwargs={"slug": world["slug"], "project_id": world["project_id"], **kwargs})


def _upstream(world, tail):
    """An upstream app-API url. Written out rather than reversed, because upstream
    gives two different routes the SAME name (`project-issue` is both the list and
    the detail; `issue-relation` is both create and remove), and `reverse` picking
    whichever it likes is not something a permission test should depend on."""
    return f"/api/workspaces/{world['slug']}/projects/{world['project_id']}/{tail}"


def _issue_url(world):
    return _upstream(world, f"issues/{world['issue'].id}/")


def test_an_actual_effort_is_the_persons_and_an_estimate_is_the_leads(governed):
    """The sharpest edge in the whole setting, and the one most worth pinning.

    "Effort" appears on both sides of the line and they are not the same number.
    How big we SAY the work is decides the labour cost a funder is shown; how
    long it actually took is the person who did it reporting a fact. A tool that
    refuses that report is a tool whose actuals are all missing.
    """
    url = _arribada(governed, "arribada-issue-effort", issue_id=str(governed["issue"].id))
    member = governed["clients"]["member"]

    logged = member.post(url, {"actual_days": 3}, format="json")
    assert logged.status_code == 200, (
        f"a member could not record the effort they actually spent: {logged.status_code} "
        f"{getattr(logged, 'data', None)}"
    )

    estimated = member.post(url, {"days": 12}, format="json")
    assert estimated.status_code == 403, (
        f"a member rewrote the ESTIMATE on a project whose plan is the lead's: "
        f"{estimated.status_code}"
    )

    # And the lead is served both, or the split is not a split.
    lead = governed["clients"]["lead"]
    assert lead.post(url, {"days": 12}, format="json").status_code == 200
    assert lead.post(url, {"actual_days": 4}, format="json").status_code == 200


def test_the_schedule_patch_refuses_a_date_and_allows_the_rest(governed):
    """Conditional on the payload, so it has to be tested with a payload.

    The sweep sends an empty body and is correctly let through; that is exactly
    the case where a handler which validated its body first would have done work
    for somebody it should have refused.
    """
    url = _arribada(governed, "arribada-project-schedule")
    member = governed["clients"]["member"]

    dated = member.patch(url, {"start_date": "2026-09-01"}, format="json")
    assert dated.status_code == 403, f"a member moved the project's start date: {dated.status_code}"

    # The governance switch itself is the LEAD's, not a workspace admin's — this
    # is the one place the two guards deliberately disagree.
    admin_flip = governed["clients"]["ws_admin"].patch(url, {"lead_only_edits": False}, format="json")
    assert admin_flip.status_code == 403, (
        "a workspace admin turned the setting off on a project that has a lead. Changing WHO "
        "may change the plan is `_lead_guard`'s question, and it does not admit an admin while "
        "the project has a lead of its own."
    )

    assert (
        governed["clients"]["lead"].patch(url, {"start_date": "2026-09-01"}, format="json").status_code
        == 200
    )


def test_a_member_still_moves_a_work_items_state(governed):
    """The one thing the help text promises by name, through upstream's own route.

    This is the request the middleware has to let past, and it travels on exactly
    the same URL and method as the date change below. If the guard ever stops
    reading the body, this is what breaks — and it is the entire day-to-day use
    of the product.
    """
    answer = governed["clients"]["member"].patch(
        _issue_url(governed), {"state_id": str(governed["other_state"].id)}, format="json"
    )
    # 204, not 200. Upstream's `IssueViewSet.partial_update` returns
    # `HTTP_204_NO_CONTENT` on success — it writes and says nothing. What this test
    # is actually asserting is "not 403", so the check is written that way and the
    # real proof is the database read below; pinning one exact success code here
    # would break the next time upstream decides to answer with the row.
    assert answer.status_code != 403, (
        f"a member could not move a work item's state on a project whose PLAN is the lead's: "
        f"{answer.status_code} {getattr(answer, 'data', None)}. States are the work, not the plan."
    )
    assert answer.status_code < 300, (
        f"the state change did not succeed: {answer.status_code} {getattr(answer, 'data', None)}"
    )
    governed["issue"].refresh_from_db()
    assert str(governed["issue"].state_id) == str(governed["other_state"].id)


def test_a_member_cannot_move_a_date_through_upstreams_issue_patch(governed):
    """Same route, same method, different body — and the opposite answer."""
    url = _issue_url(governed)
    answer = governed["clients"]["member"].patch(url, {"target_date": "2026-12-01"}, format="json")
    assert answer.status_code == 403, (
        f"a member rewrote a work item's target date: {answer.status_code}. The date pickers in "
        f"the sidebar and the peek both post this."
    )
    governed["issue"].refresh_from_db()
    assert governed["issue"].target_date is None, "refused, and the date moved anyway"

    # And the lead moves it. Upstream's `IssueViewSet.partial_update` answers 204
    # on success — it writes and says nothing — so what is asserted is "not
    # refused", not one exact success code.
    assert (
        governed["clients"]["lead"].patch(url, {"target_date": "2026-12-01"}, format="json").status_code
        < 300
    )


def test_the_gantt_bar_drag_is_guarded(governed):
    """THE reason the middleware exists.

    Dragging a bar does not go through `patchIssue`. It posts an array of dates
    to upstream's `IssueBulkUpdateDateEndpoint`, which is not in this app and
    would have been completely unguarded by a rule that stopped at our URL
    prefix — the most obvious way in the product to change when work happens.
    """
    url = reverse(
        "project-issue-dates",
        kwargs={"slug": governed["slug"], "project_id": governed["project_id"]},
    )
    payload = {"updates": [{"id": str(governed["issue"].id), "target_date": "2026-12-24"}]}

    refused = governed["clients"]["member"].post(url, payload, format="json")
    assert refused.status_code == 403, f"a member dragged a bar: {refused.status_code}"

    governed["issue"].refresh_from_db()
    assert str(governed["issue"].target_date) != "2026-12-24", (
        "the request was refused and the date moved anyway"
    )

    served = governed["clients"]["lead"].post(url, payload, format="json")
    assert served.status_code == 200, f"the lead could not drag a bar: {served.status_code}"


def test_with_the_setting_off_the_bar_drag_is_nobodys_business(governed):
    """The middleware must be invisible on a project that never asked for it."""
    _open_up(governed)
    url = reverse(
        "project-issue-dates",
        kwargs={"slug": governed["slug"], "project_id": governed["project_id"]},
    )
    answer = governed["clients"]["member"].post(
        url, {"updates": [{"id": str(governed["issue"].id), "target_date": "2026-12-24"}]}, format="json"
    )
    assert answer.status_code == 200, f"the guard fired on an ungoverned project: {answer.status_code}"


def test_a_dependency_cannot_be_created_by_a_member(governed):
    """Relations are upstream's, and "what waits for what" is the plan."""
    second = Issue.objects.create(
        name="Antenna test",
        project=governed["project"],
        workspace=governed["workspace"],
        state=governed["state"],
        created_by=governed["users"]["lead"],
    )
    url = _upstream(governed, f"issues/{governed['issue'].id}/issue-relation/")
    answer = governed["clients"]["member"].post(
        url, {"relation_type": "blocked_by", "issues": [str(second.id)]}, format="json"
    )
    assert answer.status_code == 403, f"a member wired a dependency: {answer.status_code}"


# --- the guard on the middleware's map ---------------------------------------


def test_every_guarded_name_is_a_class_that_is_actually_routed():
    """Without this, `GUARDED` is a wish.

    It is a map of upstream class NAMES, and upstream renames things. A name
    that no longer resolves silently stops guarding its route, and every
    behavioural test above would go on passing because it names its own routes
    by URL. So the map is checked against the URLconf itself: each entry must
    correspond to a class that some route actually dispatches to, on that method.
    """
    from django.urls import get_resolver

    seen = set()

    def walk(resolver):
        for entry in resolver.url_patterns:
            if hasattr(entry, "url_patterns"):
                walk(entry)
                continue
            callback = getattr(entry, "callback", None)
            cls = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
            if cls is None:
                continue
            actions = getattr(callback, "actions", None)
            if actions:
                for method in actions:
                    seen.add((cls.__name__, method.upper()))
            else:
                for method in ("post", "patch", "put", "delete"):
                    if hasattr(cls, method):
                        seen.add((cls.__name__, method.upper()))

    walk(get_resolver())

    missing = sorted(key for key in GUARDED if key not in seen)
    assert not missing, (
        f"plan_guard.GUARDED names handlers that nothing routes: {missing}. Either upstream "
        f"renamed the class or moved the method, and the guard on that route is now doing "
        f"nothing whatsoever. Fix the map — do not delete the entry."
    )
