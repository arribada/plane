# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`external_edits`: whether an integration may write here, which is NOT who may change the plan.

THE POINT OF THIS FILE IS THE DISTINCTION. `lead_only_edits` means only the lead
may change dates, dependencies and sprint membership. It does not mean only the
lead may create or edit work items, and it says nothing whatsoever about the
wiki. Reusing it to gate external writes would give a lead who wanted their dates
protected an integration they never agreed to — or refuse one they did — and
neither is predictable from the switch they actually threw. So the two settings
are asserted here to be INDEPENDENT IN BOTH DIRECTIONS, which is the assertion
that fails first if somebody later "simplifies" one into the other.

WHY THE TESTS AUTHENTICATE WITH `X-Api-Key` AND NO SESSION. Because that is what
the wiki does, and because doing it the other way hid the bug this file was
written alongside. `/api/v1/` authenticates in `APIView.initial()` — inside the
view — while the guard runs in `process_view`, before it. A version of this guard
ordered behind `is_authenticated` passed every session-authenticated test and was
INERT for every request the sync actually makes. A test that signs in the
convenient way would have shipped it.

THE SWEEP at the bottom is generated from `plane.api.urls`, for the same reason
`test_plan_guard.py` generates its own from `plane.arribada.urls`: the promise
here is a negative — "a declared external write does not land on a project that
has not opted in" — and a hand-written list of the routes a write could take is a
list somebody forgets. The wiki drives the same public API a person does, so the
route surface is upstream's and grows without us.

Needs a database.
"""

import json
import re
import uuid

import pytest
from rest_framework.test import APIClient

from plane.api.urls import urlpatterns as v1_urlpatterns
from plane.app.permissions import ROLE
from plane.arribada.models import ProjectSchedule, ProjectTeamMember
from plane.arribada.plan_guard import EXTERNAL_SOURCE
from plane.db.models import (
    APIToken,
    Issue,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)

WRITE_METHODS = ("post", "patch", "put", "delete")


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    """The handlers publish to Celery on the SUCCESS path.

    Same reasoning as `test_plan_guard.py`'s fixture: CI has Postgres but no
    RabbitMQ, so a `.delay()` on the way out of an ALLOWED write turns "the sync
    was served" into a broker timeout and then a 500 — which an assertion written
    as "not 403" would accept, and which would leave the permissive half of this
    file proving nothing.

    Patched at `Task.apply_async` rather than on each imported name, unlike that
    file. It sweeps every v1 write route, so the set of tasks reachable is the set
    upstream happens to call from any of forty handlers — links, attachments,
    relations, intake, each importing its own. Naming them is the same losing game
    the sweep exists to avoid, and `delay()` funnels into `apply_async` for all of
    them.
    """
    from celery.app.task import Task

    monkeypatch.setattr(Task, "apply_async", lambda self, *a, **k: None)


@pytest.fixture(autouse=True)
def no_throttle_carryover():
    """`ApiKeyRateThrottle` is 60/minute and the sweeps make more calls than that.

    The throttle keys on the API key and lives in the shared cache, so without
    this the second sweep in this file inherits the first one's spent budget and
    starts answering 429 — a status that is neither the refusal being asserted nor
    the success, and which would quietly hollow out whichever test ran last.
    (Only the permissive sweep reaches it at all: a refusal returns from
    `process_view`, before DRF's throttle is ever consulted in `initial()`.)
    """
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def wiki(db):
    """A project, a sync token, and the people whose permissions must not change.

    The token's user is a full project MEMBER on purpose. `ProjectEntityPermission`
    would refuse a non-member before any of this mattered, and a test where the
    write fails for the ordinary reason proves nothing about the guard — the whole
    question here is whether a caller who IS allowed to write is nonetheless
    refused because the write declares itself external.
    """
    owner = User.objects.create(email="ee-owner@arribada.test", username="ee-owner")
    workspace = Workspace.objects.create(name="Ext Edits", owner=owner, slug="ext-edits-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(
        name="Synced", workspace=workspace, created_by=owner, identifier="SYN"
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
    )
    state = State.objects.create(
        name="Backlog",
        project=project,
        workspace=workspace,
        group="backlog",
        default=True,
        sequence=1,
    )
    issue = Issue.objects.create(
        name="Existing item", project=project, workspace=workspace, state=state, created_by=owner
    )

    people, clients = {}, {}
    for label, ws_role, project_role in (
        ("lead", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("member", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("sync", ROLE.MEMBER.value, ROLE.MEMBER.value),
    ):
        user = User.objects.create(email=f"ee-{label}@arribada.test", username=f"ee-{label}")
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
        email="ee-lead@arribada.test",
        member=people["lead"],
        is_lead=True,
    )
    ProjectSchedule.objects.create(project=project)

    token = APIToken.objects.create(user=people["sync"], workspace=workspace, label="wiki sync")

    # NO session and NO `force_authenticate`. This client holds the key and
    # nothing else, exactly like the sync.
    key_only = APIClient()

    return {
        "workspace": workspace,
        "project": project,
        "project_id": str(project.id),
        "slug": workspace.slug,
        "state": state,
        "issue": issue,
        "users": people,
        "clients": clients,
        "token": token.token,
        "key_only": key_only,
    }


def _allow_external(world, value=True):
    ProjectSchedule.objects.filter(project=world["project"]).update(external_edits=value)


def _lead_only(world, value=True):
    ProjectSchedule.objects.filter(project=world["project"]).update(lead_only_edits=value)


def _work_items_url(world):
    return f"/api/v1/workspaces/{world['slug']}/projects/{world['project_id']}/work-items/"


def _declared(**extra):
    """A body that declares itself the wiki's, which is what the guard reads."""
    body = {"name": "From the wiki", "external_source": EXTERNAL_SOURCE, "external_id": "wiki-1"}
    body.update(extra)
    return body


def _post_as_sync(world, body):
    """POST a work item with the API key and no session — the sync's own shape."""
    return world["key_only"].post(
        _work_items_url(world),
        data=json.dumps(body),
        content_type="application/json",
        HTTP_X_API_KEY=world["token"],
    )


# ---------------------------------------------------------------- the guard


def test_a_declared_external_write_is_refused_by_default(wiki):
    """`default=False` means every existing project refuses until someone opts in.

    This is the assertion that says the migration is safe to deploy and that the
    sync does nothing on day one, and both halves of that are intended.
    """
    response = _post_as_sync(wiki, _declared())
    assert response.status_code == 403, response.content
    assert not Issue.objects.filter(external_id="wiki-1").exists(), (
        "the write was refused with a 403 and landed anyway"
    )


def test_the_same_write_lands_once_the_project_opts_in(wiki):
    """The permissive half. Without it a guard that refused everything would pass."""
    _allow_external(wiki)
    response = _post_as_sync(wiki, _declared())
    assert response.status_code == 201, response.content
    created = Issue.objects.filter(external_id="wiki-1", external_source=EXTERNAL_SOURCE)
    assert created.count() == 1
    assert created.first().project_id == wiki["project"].id


def test_the_guard_fires_for_a_key_only_caller_and_not_just_a_session(wiki):
    """The regression this file exists for.

    `/api/v1/` authenticates inside the view, so `request.user` in `process_view`
    is anonymous for a request carrying only `X-Api-Key`. A guard ordered behind
    `is_authenticated` is green on every session test in this repository and
    INERT for the sync. Both clients must be refused, and the key-only one is the
    one that matters.
    """
    key_only = _post_as_sync(wiki, _declared())
    session = wiki["clients"]["member"].post(
        _work_items_url(wiki), data=_declared(external_id="wiki-2"), format="json"
    )
    assert key_only.status_code == 403, key_only.content
    assert session.status_code == 403, session.content


def test_an_ordinary_write_is_untouched(wiki):
    """No declaration, no guard. The setting governs the integration, not the project.

    A member creating a work item by hand on a project that has not opted in must
    be unaffected — otherwise `default=False` would have taken the New Item button
    away from every project in production at the moment the image rolled.
    """
    response = wiki["clients"]["member"].post(
        _work_items_url(wiki), data={"name": "Typed by a person"}, format="json"
    )
    assert response.status_code == 201, response.content


def test_a_different_external_source_is_not_this_setting(wiki):
    """The guard is keyed on OUR source string, not on the field being present.

    GitHub import already writes `external_source` on this table. If the guard
    read "declares any external source" it would silently break that importer on
    every project that had not opted in to the wiki.
    """
    response = _post_as_sync(wiki, _declared(external_source="github", external_id="gh-1"))
    assert response.status_code == 201, response.content


# --------------------------------------------- the distinction, both directions


def test_lead_only_edits_does_not_grant_external_writes(wiki):
    """The sharpest assertion in this file, and the reason the column is separate.

    A project can be governed to the hilt — the plan locked to its lead — and still
    have said nothing about whether the wiki may file work items into it. If a
    later change answers the external question with `lead_only_edits`, this fails.
    """
    _lead_only(wiki, True)
    assert _post_as_sync(wiki, _declared()).status_code == 403

    _lead_only(wiki, False)
    assert _post_as_sync(wiki, _declared()).status_code == 403, (
        "turning lead_only_edits OFF changed the answer to the external question, "
        "which means the two settings have been collapsed into one"
    )


def test_external_edits_does_not_grant_plan_writes(wiki):
    """And the converse: opting in to the sync does not unlock the timeline.

    A lead who lets the wiki file work items has not thereby let every member move
    a date. `external_edits` is about a caller; `lead_only_edits` is about a person.
    """
    _allow_external(wiki, True)
    _lead_only(wiki, True)
    response = wiki["clients"]["member"].patch(
        f"/api/workspaces/{wiki['slug']}/projects/{wiki['project_id']}"
        f"/issues/{wiki['issue'].id}/",
        data={"target_date": "2026-12-01"},
        format="json",
    )
    assert response.status_code == 403, (
        f"external_edits=True opened a plan write to a plain member ({response.status_code}); "
        f"the two settings have been collapsed into one"
    )


def test_a_declared_external_plan_write_still_answers_the_plan_question(wiki):
    """Both guards apply; opting in to one does not excuse the other."""
    _allow_external(wiki, True)
    _lead_only(wiki, True)
    response = wiki["clients"]["member"].patch(
        f"/api/workspaces/{wiki['slug']}/projects/{wiki['project_id']}"
        f"/issues/{wiki['issue'].id}/",
        data={"target_date": "2026-12-01", "external_source": EXTERNAL_SOURCE},
        format="json",
    )
    assert response.status_code == 403, response.content


# ------------------------------------------------------------- who may flip it


def test_only_the_lead_may_turn_external_edits_on(wiki):
    """Granting an integration write access is a governance act, like the others.

    A member who could flip this could give the wiki write access to a project
    whose lead never agreed to the sync — and could do it in the same breath as
    the write it refuses.
    """
    url = f"/api/arribada/workspaces/{wiki['slug']}/projects/{wiki['project_id']}/schedule/"

    refused = wiki["clients"]["member"].patch(url, data={"external_edits": True}, format="json")
    assert refused.status_code == 403, refused.content
    assert not ProjectSchedule.objects.filter(
        project=wiki["project"], external_edits=True
    ).exists()

    allowed = wiki["clients"]["lead"].patch(url, data={"external_edits": True}, format="json")
    assert allowed.status_code == 200, allowed.content
    assert ProjectSchedule.objects.filter(project=wiki["project"], external_edits=True).exists()


def test_the_schedule_read_reports_the_flag(wiki):
    """The lead has to be able to see the answer to change it."""
    _allow_external(wiki, True)
    url = f"/api/arribada/workspaces/{wiki['slug']}/projects/{wiki['project_id']}/schedule/"
    response = wiki["clients"]["member"].get(url)
    assert response.status_code == 200, response.content
    assert response.json()["external_edits"] is True


# ------------------------------------------------- the v1 project payload (item 3)


def test_the_v1_project_payload_carries_external_edits(wiki):
    """The wiki reads this instead of keeping its own copy of the policy.

    Both values, because a field hardcoded to False would pass a test that only
    checked the default and would tell the sync every project had refused.
    """
    url = f"/api/v1/workspaces/{wiki['slug']}/projects/"

    off = wiki["key_only"].get(url, HTTP_X_API_KEY=wiki["token"]).json()
    row = next(p for p in off["results"] if p["id"] == wiki["project_id"])
    assert row["external_edits"] is False

    _allow_external(wiki, True)
    on = wiki["key_only"].get(url, HTTP_X_API_KEY=wiki["token"]).json()
    row = next(p for p in on["results"] if p["id"] == wiki["project_id"])
    assert row["external_edits"] is True


def test_the_project_payload_survives_a_project_with_no_schedule_row(wiki):
    """`ProjectSerializer` is also the webhook payload serializer and is called on
    plain instances in four places. A declared field over a missing annotation
    would 500 every one of them; the method field must answer False instead."""
    ProjectSchedule.objects.filter(project=wiki["project"]).delete()
    response = wiki["key_only"].get(
        f"/api/v1/workspaces/{wiki['slug']}/projects/{wiki['project_id']}/",
        HTTP_X_API_KEY=wiki["token"],
    )
    assert response.status_code == 200, response.content
    assert response.json()["external_edits"] is False


# ------------------------------------------------ the external_source filter (item 4)


def test_the_list_filters_by_external_source(wiki):
    """The traffic cut. Without it the sync reads every item to find its own."""
    for index, source in enumerate(["arribada-wiki", "arribada-wiki", "github", None]):
        Issue.objects.create(
            name=f"item-{index}",
            project=wiki["project"],
            workspace=wiki["workspace"],
            state=wiki["state"],
            external_source=source,
            external_id=f"x-{index}" if source else None,
        )

    response = wiki["key_only"].get(
        _work_items_url(wiki),
        {"external_source": EXTERNAL_SOURCE},
        HTTP_X_API_KEY=wiki["token"],
    )
    assert response.status_code == 200, response.content
    payload = response.json()
    sources = {row["external_source"] for row in payload["results"]}
    assert sources == {EXTERNAL_SOURCE}, sources
    assert len(payload["results"]) == 2

    # The COUNT as well as the rows. A page of two that claims a total of five
    # makes a client that pages to `total_count` loop forever.
    assert payload["total_count"] == 2, payload["total_count"]


def test_the_unfiltered_list_is_unchanged(wiki):
    """No parameter, no filter — the endpoint everybody else calls still answers."""
    response = wiki["key_only"].get(_work_items_url(wiki), HTTP_X_API_KEY=wiki["token"])
    assert response.status_code == 200, response.content
    assert response.json()["total_count"] == 1


def test_external_id_with_external_source_still_fetches_the_one_item(wiki):
    """The pre-existing contract. Both parameters mean "the one item", and the
    response is a bare object rather than a page — callers already depend on it."""
    Issue.objects.create(
        name="the one",
        project=wiki["project"],
        workspace=wiki["workspace"],
        state=wiki["state"],
        external_source=EXTERNAL_SOURCE,
        external_id="only-me",
    )
    response = wiki["key_only"].get(
        _work_items_url(wiki),
        {"external_source": EXTERNAL_SOURCE, "external_id": "only-me"},
        HTTP_X_API_KEY=wiki["token"],
    )
    assert response.status_code == 200, response.content
    assert response.json()["external_id"] == "only-me"


def test_the_filter_cannot_reach_a_project_the_caller_is_not_in(wiki):
    """The filter narrows what the caller could already read; it does not widen it.

    Asserted rather than argued, because "it is behind the same permission" is the
    kind of claim that stops being true when somebody adds a workspace-wide
    variant of the same parameter.
    """
    # `network=2` — PUBLIC, and it is the model default — on purpose, because
    # that is the dangerous case rather than the safe one. The v1 project LIST
    # deliberately returns every public project in the workspace whether or not
    # the caller is a member (`ProjectListCreateAPIEndpoint.get_queryset`, the
    # `| Q(network=2)` branch), so an API key can already DISCOVER the id of a
    # project it is not in. The question this test asks is whether the new filter
    # then lets it READ that project's items, and the answer must be no —
    # `ProjectEntityPermission` requires an active ProjectMember row regardless of
    # network. A private project would have proved the easy half only.
    outsider = Project.objects.create(
        name="Not yours",
        workspace=wiki["workspace"],
        created_by=wiki["users"]["lead"],
        identifier="NOT",
        network=2,
    )
    state = State.objects.create(
        name="Backlog", project=outsider, workspace=wiki["workspace"], group="backlog", sequence=1
    )
    Issue.objects.create(
        name="secret",
        project=outsider,
        workspace=wiki["workspace"],
        state=state,
        external_source=EXTERNAL_SOURCE,
        external_id="secret-1",
    )
    response = wiki["key_only"].get(
        f"/api/v1/workspaces/{wiki['slug']}/projects/{outsider.id}/work-items/",
        {"external_source": EXTERNAL_SOURCE},
        HTTP_X_API_KEY=wiki["token"],
    )
    assert response.status_code in (403, 404), response.status_code


# ------------------------------------------------------------------- the sweep


def _v1_project_write_routes():
    """(route, class name, method) for every v1 write handler on a project route.

    Generated from `plane.api.urls`, not written by hand. The wiki drives the
    public API, so the surface it could write through is upstream's and grows
    without anybody here noticing.
    """
    out = []
    for entry in v1_urlpatterns:
        route = str(entry.pattern)
        if "<uuid:project_id>" not in route:
            continue
        cls = getattr(entry.callback, "cls", None) or getattr(entry.callback, "view_class", None)
        if cls is None:
            continue
        for name in WRITE_METHODS:
            if hasattr(cls, name) and (route, cls.__name__, name) not in out:
                out.append((route, cls.__name__, name))
    return out


V1_WRITE_ROUTES = _v1_project_write_routes()
V1_WRITE_IDS = [f"{name}.{method}" for _route, name, method in V1_WRITE_ROUTES]


def test_the_sweep_found_the_v1_write_surface():
    """A sweep over an empty list passes and proves nothing."""
    assert len(V1_WRITE_ROUTES) >= 15, V1_WRITE_IDS


def _fill(route, world):
    """The v1 route with its placeholders filled in.

    Ids other than the project are random on purpose: the guard runs before the
    view looks a row up, so the refusal must not depend on the row existing.
    """
    url = route.replace("<str:slug>", world["slug"]).replace(
        "<uuid:project_id>", world["project_id"]
    )
    url = re.sub(r"<[^:>]+:[^>]+>", lambda _match: str(uuid.uuid4()), url)
    return "/api/v1/" + url.lstrip("^").lstrip("/")


def test_every_v1_project_write_refuses_a_declared_external_body(wiki):
    """The negative, swept.

    A declared external write must not land ANYWHERE on a project that has not
    opted in — not through work items, not through comments, not through links or
    attachments. A guard that covered only the endpoint somebody thought of would
    simply move the traffic to the next one.
    """
    escaped = {}
    for route, name, method in V1_WRITE_ROUTES:
        response = getattr(wiki["key_only"], method)(
            _fill(route, wiki),
            data=json.dumps(_declared()),
            content_type="application/json",
            HTTP_X_API_KEY=wiki["token"],
        )
        if response.status_code != 403:
            escaped[f"{name}.{method}"] = response.status_code
    assert not escaped, (
        f"these v1 write handlers accepted a body declaring external_source "
        f"'{EXTERNAL_SOURCE}' on a project that has not opted in: {escaped}. Either the "
        f"guard stopped covering them or it never did — it is a middleware on "
        f"`project_id`, so a route that names one should be refused without anybody "
        f"listing it."
    )


def test_the_same_sweep_stops_refusing_once_the_project_opts_in(wiki):
    """The other direction, or a guard that refused everything would pass above.

    ASKED OF THE MIDDLEWARE DIRECTLY rather than through the client, and that is
    a deliberate retreat from end-to-end. Letting forty handlers actually run with
    invented ids does not test this guard: they insert rows against random foreign
    keys, and the first `IntegrityError` poisons the transaction so that everything
    after it reports the database's complaint rather than the permission's answer.
    (It also spends the 60/minute API-key throttle a third of the way through,
    which is its own kind of wrong answer.) The end-to-end half is already proved
    on real routes with real bodies by the three tests above; what is left to
    prove per-route is that the DECISION flips, and the decision is one function.
    """
    from django.test import RequestFactory
    from django.urls import resolve

    from plane.arribada.plan_guard import PlanEditGuardMiddleware

    _allow_external(wiki, True)
    middleware = PlanEditGuardMiddleware(lambda request: None)
    factory = RequestFactory()

    still_refused = {}
    for route, name, method in V1_WRITE_ROUTES:
        url = _fill(route, wiki)
        match = resolve(url)
        request = getattr(factory, method)(
            url, data=json.dumps(_declared()), content_type="application/json"
        )
        response = middleware.process_view(request, match.func, match.args, match.kwargs)
        if response is not None:
            still_refused[f"{name}.{method}"] = response.status_code
    assert not still_refused, (
        f"these handlers were still refused by the guard after the project opted in: "
        f"{still_refused}"
    )


def test_the_guard_level_sweep_refuses_them_all_while_opted_out(wiki):
    """The same direct sweep, opted out — so the test above cannot pass vacuously.

    Without this, a `process_view` that returned None unconditionally (the guard
    deleted) would satisfy the permissive sweep perfectly.
    """
    from django.test import RequestFactory
    from django.urls import resolve

    from plane.arribada.plan_guard import PlanEditGuardMiddleware

    middleware = PlanEditGuardMiddleware(lambda request: None)
    factory = RequestFactory()

    escaped = {}
    for route, name, method in V1_WRITE_ROUTES:
        url = _fill(route, wiki)
        match = resolve(url)
        request = getattr(factory, method)(
            url, data=json.dumps(_declared()), content_type="application/json"
        )
        response = middleware.process_view(request, match.func, match.args, match.kwargs)
        if response is None or response.status_code != 403:
            escaped[f"{name}.{method}"] = None if response is None else response.status_code
    assert not escaped, (
        f"the guard did not refuse these while the project was opted out: {escaped}"
    )
