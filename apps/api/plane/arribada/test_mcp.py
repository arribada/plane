# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The MCP server, proved in both directions.

EVERY REFUSAL TEST HERE HAS A MATCHING SERVICE TEST, and that is the whole
design of this file rather than a courtesy. A test that only proves a refusal
passes against an endpoint that refuses everybody — which is exactly how a
security fix shipped in this repo once with five holes open under a green tick.
So for each control:

    the token's money flag off   -> budget REFUSED
    the token's money flag on    -> budget returns 12345.00, the exact figure
                                    written into the fixture

    the token restricted to TAG  -> SEA refused
                                    TAG still returns its work items

    a read-only token            -> create refused
    a write token, no opt-in     -> create refused, naming the switch
    a write token, opt-in on     -> the row is in the database afterwards

A filter that returns nothing is indistinguishable from a filter that works, so
nothing below asserts on an empty list: every positive control lands on a
specific, non-zero value.

THE CLAIM THIS FILE EXISTS TO TEST is the one in `mcp_models.py`: a token can
never do anything its owner could not do. `test_a_guests_money_token_is_still_
refused_the_money` is the important one — it gives a GUEST a token with
`allow_money=True` and shows the budget is still refused, because the grant is an
intersection and the endpoint's `MONEY_ROLES` is the other half of it.
"""

import json
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.mcp_auth import generate_secret, hash_secret, prefix_of
from plane.arribada.models import MCPCallLog, MCPToken, ProjectSchedule
from plane.db.models import (
    Cycle,
    CycleIssue,
    Estimate,
    EstimatePoint,
    Issue,
    IssueAssignee,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def world(db):
    """Two projects, three people with different authority, and one exact figure.

    `TAG` carries a budget of 12345.00 so that every money assertion below can
    land on a number that is neither zero nor derived — if the plumbing silently
    stopped reaching `ProjectBudgetEndpoint`, a zero would still look plausible.
    """
    owner = User.objects.create(email="owner@arribada.test", username="mcp-owner", first_name="Owner")
    workspace = Workspace.objects.create(name="MCP", owner=owner, slug="mcp-fixture")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    projects = {}
    for identifier, name in (("TAG", "Turtle tag"), ("SEA", "Sea survey")):
        project = Project.objects.create(
            name=name, workspace=workspace, created_by=owner, identifier=identifier
        )
        ProjectMember.objects.create(
            project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
        )
        State.objects.create(
            name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
        )
        State.objects.create(
            name="In progress", project=project, workspace=workspace, group="started", sequence=2
        )
        projects[identifier] = project

    # The exact figure every money assertion lands on.
    ProjectSchedule.objects.create(
        project=projects["TAG"], budget_amount="12345.00", budget_currency="EUR"
    )

    # One real work item, so a list that works is distinguishable from a list
    # that silently returns nothing.
    Issue.objects.create(
        workspace=workspace,
        project=projects["TAG"],
        name="Pot the antenna",
        state=State.objects.filter(project=projects["TAG"], default=True).first(),
        created_by=owner,
    )

    guest = User.objects.create(email="guest@arribada.test", username="mcp-guest", first_name="Guest")
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=ROLE.MEMBER.value)
    ProjectMember.objects.create(
        project=projects["TAG"], workspace=workspace, member=guest, role=ROLE.GUEST.value
    )

    member = User.objects.create(email="member@arribada.test", username="mcp-member", first_name="Member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=ROLE.MEMBER.value)
    ProjectMember.objects.create(
        project=projects["TAG"], workspace=workspace, member=member, role=ROLE.MEMBER.value
    )

    return {
        "workspace": workspace,
        "projects": projects,
        "owner": owner,
        "guest": guest,
        "member": member,
    }


def issue_token(user, workspace, **kwargs):
    """Mint a token the way the management command does, and hand back the secret."""
    secret = generate_secret()
    token = MCPToken.objects.create(
        name=kwargs.pop("name", "test"),
        token_hash=hash_secret(secret),
        prefix=prefix_of(secret),
        user=user,
        workspace=workspace,
        **kwargs,
    )
    return secret, token


def client_for(secret):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {secret}")
    return client


URL = None


def _url():
    global URL
    if URL is None:
        URL = reverse("arribada-mcp")
    return URL


def rpc(client, method, params=None, request_id=1):
    return client.post(
        _url(),
        data=json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}),
        content_type="application/json",
    )


def call(client, tool, arguments=None):
    """A `tools/call`, unwrapped to (payload_or_message, is_error).

    A refused tool is an HTTP 200 carrying `isError: true` — see the docstring on
    `mcp.py` for why — so a test that asserted on the status code would pass
    whatever happened. Everything here asserts on `isError` and on the text.
    """
    response = rpc(client, "tools/call", {"name": tool, "arguments": arguments or {}})
    assert response.status_code == 200, response.content
    result = response.json()["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        return text, True
    try:
        return json.loads(text), False
    except ValueError:
        return text, False


# ---------------------------------------------------------------------------
# Transport and authentication
# ---------------------------------------------------------------------------


def test_no_credential_is_401_and_says_how_to_authenticate(world):
    response = rpc(APIClient(), "tools/list")
    assert response.status_code == 401
    # Without this header an MCP client reports "forbidden" rather than
    # "needs a token", and the user is sent looking for the wrong problem.
    assert "Bearer" in response.headers.get("WWW-Authenticate", "")


def test_an_unknown_secret_is_refused(world):
    response = rpc(client_for(generate_secret()), "tools/list")
    assert response.status_code == 401


def test_a_revoked_token_stops_working_immediately(world):
    secret, token = issue_token(world["owner"], world["workspace"])
    client = client_for(secret)
    assert rpc(client, "tools/list").status_code == 200  # positive control

    token.revoked_at = timezone.now()
    token.save(update_fields=["revoked_at"])
    response = rpc(client, "tools/list")
    assert response.status_code == 401
    assert "revoked" in response.json().get("detail", "").lower()


def test_an_expired_token_stops_working(world):
    secret, token = issue_token(world["owner"], world["workspace"])
    assert rpc(client_for(secret), "tools/list").status_code == 200  # positive control

    token.expires_at = timezone.now() - timedelta(seconds=1)
    token.save(update_fields=["expires_at"])
    assert rpc(client_for(secret), "tools/list").status_code == 401


def test_the_secret_is_never_stored(world):
    secret, token = issue_token(world["owner"], world["workspace"])
    token.refresh_from_db()
    # The row must not be able to reproduce the credential it authenticates.
    assert secret not in json.dumps(
        {f.name: str(getattr(token, f.name)) for f in MCPToken._meta.fields}
    )
    assert token.token_hash == hash_secret(secret)
    assert len(token.prefix) == 16 and secret.startswith(token.prefix)


def test_initialize_negotiates_and_names_the_server(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    body = rpc(client_for(secret), "initialize", {"protocolVersion": "2025-06-18"}).json()
    assert body["result"]["protocolVersion"] == "2025-06-18"
    assert body["result"]["serverInfo"]["name"] == "arribada-plane"
    assert "tools" in body["result"]["capabilities"]


def test_an_unknown_protocol_version_is_answered_not_refused(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    body = rpc(client_for(secret), "initialize", {"protocolVersion": "2099-01-01"}).json()
    assert body["result"]["protocolVersion"] == "2025-06-18"


def test_the_initialized_notification_gets_no_body(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    response = client_for(secret).post(
        _url(),
        data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        content_type="application/json",
    )
    assert response.status_code == 202
    assert not response.content


def test_an_unknown_method_is_a_jsonrpc_error_not_a_crash(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    body = rpc(client_for(secret), "tools/nonesuch").json()
    assert body["error"]["code"] == -32601


def test_the_health_route_needs_no_credential_and_leaks_nothing(world):
    response = APIClient().get(reverse("arribada-mcp-health"))
    assert response.status_code == 200
    text = response.content.decode()
    assert "arribada-plane" in text
    # It must not confirm a workspace, count tokens, or name a person.
    assert "mcp-fixture" not in text and "arribada.test" not in text


# ---------------------------------------------------------------------------
# The grant is an intersection — both directions
# ---------------------------------------------------------------------------


def test_a_read_token_reads_a_real_project(world):
    """The positive control the refusal tests below depend on."""
    secret, _ = issue_token(world["owner"], world["workspace"])
    payload, error = call(client_for(secret), "list_work_items", {"project": "TAG"})
    assert not error, payload
    assert payload["count"] == 1
    assert payload["items"][0]["name"] == "Pot the antenna"
    assert payload["items"][0]["reference"] == "TAG-1"


def test_money_is_refused_without_the_flag(world):
    secret, _ = issue_token(world["owner"], world["workspace"], allow_money=False)
    message, error = call(client_for(secret), "get_project_budget", {"project": "TAG"})
    assert error
    assert "finance" in message.lower()


def test_money_is_served_with_the_flag_and_the_figure_is_the_real_one(world):
    """The other direction, and it lands on 12345.00 rather than on 'not refused'.

    If this layer ever stopped reaching `ProjectBudgetEndpoint` and started
    computing its own answer, a plausible zero would pass a test that only
    asserted the call succeeded.
    """
    secret, _ = issue_token(world["owner"], world["workspace"], allow_money=True)
    payload, error = call(client_for(secret), "get_project_budget", {"project": "TAG"})
    assert not error, payload
    assert float(payload["allocation"]["amount"]) == 12345.00
    assert payload["allocation"]["currency"] == "EUR"


def test_a_guests_money_token_is_still_refused_the_money(world):
    """THE test. A GUEST holding a token with `allow_money=True` still cannot read
    the budget, because the grant is an intersection and `MONEY_ROLES` is the
    other half of it. A token cannot grant what its owner does not have."""
    secret, _ = issue_token(world["guest"], world["workspace"], allow_money=True)
    message, error = call(client_for(secret), "get_project_budget", {"project": "TAG"})
    assert error, message
    assert "permission" in message.lower() or "required" in message.lower()


def test_a_guest_is_still_served_what_guests_may_read(world):
    """The service half: narrowing the money must not have closed the project."""
    secret, _ = issue_token(world["guest"], world["workspace"])
    payload, error = call(client_for(secret), "list_work_items", {"project": "TAG"})
    assert not error, payload
    assert payload["count"] == 1


def test_the_project_allow_list_refuses_what_is_outside_it(world):
    secret, _ = issue_token(
        world["owner"], world["workspace"], project_ids=[str(world["projects"]["TAG"].id)]
    )
    message, error = call(client_for(secret), "list_work_items", {"project": "SEA"})
    assert error
    assert "restricted" in message.lower()


def test_the_project_allow_list_still_serves_what_is_inside_it(world):
    secret, _ = issue_token(
        world["owner"], world["workspace"], project_ids=[str(world["projects"]["TAG"].id)]
    )
    payload, error = call(client_for(secret), "list_work_items", {"project": "TAG"})
    assert not error, payload
    assert payload["count"] == 1


def test_an_empty_allow_list_means_every_project_not_none(world):
    """`project_ids=[]` is the default, and reading it as "nothing allowed" would
    make every freshly issued token useless in a way that looks like a bug in the
    client."""
    secret, _ = issue_token(world["owner"], world["workspace"], project_ids=[])
    payload, error = call(client_for(secret), "list_work_items", {"project": "SEA"})
    assert not error, payload
    assert payload["count"] == 0  # SEA genuinely has no items; TAG above proves the query works


def test_whoami_states_the_grant(world):
    secret, _ = issue_token(
        world["owner"],
        world["workspace"],
        name="Claude",
        allow_money=True,
        project_ids=[str(world["projects"]["TAG"].id)],
    )
    payload, error = call(client_for(secret), "whoami")
    assert not error, payload
    assert payload["user"]["email"] == "owner@arribada.test"
    assert payload["token"]["may_read_money"] is True
    assert payload["token"]["may_write"] is False
    assert [p["identifier"] for p in payload["reachable_projects"]] == ["TAG"]
    assert payload["reachable_project_count"] == 1
    # Measured on production before this line existed: whoami said 52 and
    # list_projects said 23, because one counts archived projects and the other
    # does not. Both were right and the pair was misleading, so the note says so.
    assert "ARCHIVED" in payload["note"]


# ---------------------------------------------------------------------------
# What the tool list advertises
# ---------------------------------------------------------------------------


def _tool_names(secret):
    body = rpc(client_for(secret), "tools/list").json()
    return {t["name"] for t in body["result"]["tools"]}


def test_a_read_token_is_not_offered_money_or_writes(world):
    names = _tool_names(issue_token(world["owner"], world["workspace"])[0])
    assert "list_work_items" in names  # positive control: the list is not empty
    assert "get_project_budget" not in names
    assert "create_work_item" not in names


def test_a_money_token_is_offered_money_and_still_not_writes(world):
    names = _tool_names(issue_token(world["owner"], world["workspace"], allow_money=True)[0])
    assert "get_project_budget" in names
    assert "create_work_item" not in names


def test_a_write_token_is_offered_writes(world):
    names = _tool_names(
        issue_token(world["owner"], world["workspace"], scope=MCPToken.SCOPE_WRITE)[0]
    )
    assert "create_work_item" in names
    assert "update_work_item" in names
    assert "add_comment" in names


def test_hiding_a_tool_is_not_the_control(world):
    """A tool absent from `tools/list` must still be refused when called by name.

    Otherwise the security boundary would be a hint to a language model, which is
    not a boundary at all.
    """
    secret, _ = issue_token(world["owner"], world["workspace"])  # read-only, no money
    message, error = call(client_for(secret), "create_work_item", {"project": "TAG", "name": "x"})
    assert error
    assert "read-only" in message.lower()


# ---------------------------------------------------------------------------
# Writes — three gates
# ---------------------------------------------------------------------------


def _write_token(world, user=None):
    return issue_token(
        user or world["owner"], world["workspace"], scope=MCPToken.SCOPE_WRITE
    )[0]


def test_a_write_is_refused_until_the_project_opts_in(world):
    secret = _write_token(world)
    message, error = call(
        client_for(secret), "create_work_item", {"project": "TAG", "name": "Order connectors"}
    )
    assert error
    assert "external edits" in message.lower()
    assert Issue.objects.filter(name="Order connectors").count() == 0


def test_a_write_lands_once_the_project_has_opted_in(world):
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world)
    payload, error = call(
        client_for(secret),
        "create_work_item",
        {"project": "TAG", "name": "Order connectors", "priority": "high"},
    )
    assert not error, payload
    created = Issue.objects.filter(name="Order connectors").first()
    assert created is not None
    assert created.priority == "high"
    # Stamped so every row an agent touched can be found later — this is what
    # migration 0043 indexed and what the v1 `?external_source=` filter reads.
    assert created.external_source == "arribada-mcp"
    assert payload["reference"] == f"TAG-{created.sequence_id}"


def test_a_guest_with_a_write_token_still_cannot_write(world):
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world, world["guest"])
    message, error = call(
        client_for(secret), "create_work_item", {"project": "TAG", "name": "Sneak"}
    )
    assert error
    assert "member" in message.lower()
    assert Issue.objects.filter(name="Sneak").count() == 0


def test_a_member_with_a_write_token_can_write(world):
    """The service half of the test above — otherwise a decorator hardened to
    refuse everybody would pass it."""
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world, world["member"])
    payload, error = call(
        client_for(secret), "create_work_item", {"project": "TAG", "name": "Legitimate"}
    )
    assert not error, payload
    assert Issue.objects.filter(name="Legitimate").count() == 1


def test_the_plan_is_refused_by_name(world):
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world)
    message, error = call(
        client_for(secret),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "target_date": "2027-01-01"},
    )
    assert error
    assert "target_date" in message


def test_a_non_plan_update_still_works(world):
    """The other direction: refusing the plan must not have refused everything."""
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world)
    payload, error = call(
        client_for(secret),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "priority": "urgent"},
    )
    assert not error, payload
    assert Issue.objects.get(name="Pot the antenna").priority == "urgent"


def test_a_comment_is_escaped(world):
    ProjectSchedule.objects.filter(project=world["projects"]["TAG"]).update(external_edits=True)
    secret = _write_token(world)
    payload, error = call(
        client_for(secret),
        "add_comment",
        {"project": "TAG", "item": "TAG-1", "text": "<img src=x onerror=alert(1)>"},
    )
    assert not error, payload
    from plane.db.models import IssueComment

    comment = IssueComment.objects.get(id=payload["comment_id"])
    assert "<img" not in comment.comment_html
    assert "&lt;img" in comment.comment_html


# ---------------------------------------------------------------------------
# Resolving what the agent named
# ---------------------------------------------------------------------------


def test_a_project_can_be_named_by_identifier_id_or_name(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    client = client_for(secret)
    for value in ("TAG", str(world["projects"]["TAG"].id), "Turtle tag", "turtle"):
        payload, error = call(client, "list_work_items", {"project": value})
        assert not error, (value, payload)
        assert payload["project"]["identifier"] == "TAG"


def test_an_unknown_project_says_so_rather_than_answering_emptily(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    message, error = call(client_for(secret), "list_work_items", {"project": "nope"})
    assert error
    assert "list_projects" in message


def test_a_work_item_can_be_named_by_reference_or_title(world):
    secret, _ = issue_token(world["owner"], world["workspace"])
    client = client_for(secret)
    for value in ("TAG-1", "1", "antenna"):
        payload, error = call(client, "get_work_item", {"project": "TAG", "item": value})
        assert not error, (value, payload)
        assert payload["reference"] == "TAG-1"


# ---------------------------------------------------------------------------
# The audit log
# ---------------------------------------------------------------------------


def test_every_call_is_logged_including_the_refused_ones(world):
    secret, token = issue_token(world["owner"], world["workspace"])  # no money
    client = client_for(secret)
    call(client, "whoami")
    call(client, "get_project_budget", {"project": "TAG"})  # refused

    rows = list(MCPCallLog.objects.filter(token=token).order_by("created_at"))
    assert [r.tool for r in rows] == ["whoami", "get_project_budget"]
    assert rows[0].ok is True
    assert rows[1].ok is False and rows[1].error
    assert rows[0].token_prefix == token.prefix


def test_the_log_does_not_keep_the_answer(world):
    """A log that mirrors what it guards is a second copy of the thing to protect.
    Arguments are kept; results are not."""
    secret, token = issue_token(world["owner"], world["workspace"], allow_money=True)
    call(client_for(secret), "get_project_budget", {"project": "TAG"})
    row = MCPCallLog.objects.filter(token=token, tool="get_project_budget").first()
    assert row is not None and row.ok
    assert "TAG" in row.arguments  # the argument IS kept
    assert "12345" not in row.arguments
    assert "12345" not in row.error


def test_the_log_survives_the_token(world):
    secret, token = issue_token(world["owner"], world["workspace"])
    call(client_for(secret), "whoami")
    prefix = token.prefix
    token.delete()
    row = MCPCallLog.objects.filter(token_prefix=prefix).first()
    assert row is not None and row.tool == "whoami"
    assert row.token is None


# ---------------------------------------------------------------------------
# Filters
#
# Every one of these asserts a specific non-zero result BEFORE asserting the
# empty one. The assignee filter shipped its first draft matching `display_name`
# and `email` against an endpoint whose assignee dicts carry neither, so it
# returned nothing for every input — and a length-zero assertion would have
# called that working.
# ---------------------------------------------------------------------------


def test_filtering_by_assignee_finds_the_assignee(world):
    item = Issue.objects.get(name="Pot the antenna")
    IssueAssignee.objects.create(
        issue=item, assignee=world["member"], project=world["projects"]["TAG"],
        workspace=world["workspace"],
    )
    secret, _ = issue_token(world["owner"], world["workspace"])
    client = client_for(secret)

    hit, error = call(client, "list_work_items", {"project": "TAG", "assignee": "Member"})
    assert not error, hit
    assert hit["count"] == 1 and hit["items"][0]["reference"] == "TAG-1"

    miss, error = call(client, "list_work_items", {"project": "TAG", "assignee": "Nobody"})
    assert not error, miss
    assert miss["count"] == 0


def test_the_state_filters_separate_open_from_done(world):
    done = State.objects.create(
        name="Done", project=world["projects"]["TAG"], workspace=world["workspace"],
        group="completed", sequence=3,
    )
    Issue.objects.create(
        workspace=world["workspace"], project=world["projects"]["TAG"],
        name="Already finished", state=done, created_by=world["owner"],
    )
    secret, _ = issue_token(world["owner"], world["workspace"])
    client = client_for(secret)

    everything, _e = call(client, "list_work_items", {"project": "TAG"})
    assert everything["count"] == 2

    open_only, _e = call(client, "list_work_items", {"project": "TAG", "open_only": True})
    assert open_only["count"] == 1
    assert open_only["items"][0]["name"] == "Pot the antenna"

    finished, _e = call(client, "list_work_items", {"project": "TAG", "state_group": "completed"})
    assert finished["count"] == 1
    assert finished["items"][0]["name"] == "Already finished"


def test_truncation_is_announced_rather_than_silent(world):
    """A list that stops at its ceiling without saying so reads as a complete
    answer, and an agent will report it as one."""
    Issue.objects.create(
        workspace=world["workspace"], project=world["projects"]["TAG"], name="Second",
        state=State.objects.filter(project=world["projects"]["TAG"], default=True).first(),
        created_by=world["owner"],
    )
    secret, _ = issue_token(world["owner"], world["workspace"])

    full, _e = call(client_for(secret), "list_work_items", {"project": "TAG"})
    assert full["count"] == 2 and full["truncated"] is False

    capped, _e = call(client_for(secret), "list_work_items", {"project": "TAG", "limit": 1})
    assert capped["count"] == 2 and capped["returned"] == 1 and capped["truncated"] is True


# ---------------------------------------------------------------------------
# The allow-list on the WORKSPACE-WIDE tools
#
# These exist because the first draft leaked. `list_projects` guessed that
# `PortfolioEndpoint` answers `{"projects": [...]}`; it answers a flat list, so
# the filter matched nothing and passed the payload through — a token restricted
# to one project listed every project its user could see. The allow-list test
# that was supposed to cover this only ever exercised `list_work_items`.
#
# So each of these asserts the NARROWED result AND the unrestricted one, and the
# helper they now share refuses a shape it cannot scope rather than returning it.
# ---------------------------------------------------------------------------


def test_the_allow_list_narrows_the_project_list(world):
    unrestricted, _ = issue_token(world["owner"], world["workspace"])
    everything, error = call(client_for(unrestricted), "list_projects")
    assert not error, everything
    assert {p["identifier"] for p in everything} == {"TAG", "SEA"}

    restricted, _ = issue_token(
        world["owner"], world["workspace"], project_ids=[str(world["projects"]["TAG"].id)]
    )
    narrowed, error = call(client_for(restricted), "list_projects")
    assert not error, narrowed
    assert {p["identifier"] for p in narrowed} == {"TAG"}


def test_the_allow_list_narrows_my_work(world):
    for identifier in ("TAG", "SEA"):
        project = world["projects"][identifier]
        item = Issue.objects.create(
            workspace=world["workspace"], project=project, name=f"Mine in {identifier}",
            state=State.objects.filter(project=project, default=True).first(),
            created_by=world["owner"],
        )
        IssueAssignee.objects.create(
            issue=item, assignee=world["owner"], project=project, workspace=world["workspace"]
        )

    unrestricted, _ = issue_token(world["owner"], world["workspace"])
    both, error = call(client_for(unrestricted), "my_work")
    assert not error, both
    assert {r["project_identifier"] for r in both} == {"TAG", "SEA"}

    restricted, _ = issue_token(
        world["owner"], world["workspace"], project_ids=[str(world["projects"]["TAG"].id)]
    )
    narrowed, error = call(client_for(restricted), "my_work")
    assert not error, narrowed
    assert {r["project_identifier"] for r in narrowed} == {"TAG"}


def test_workload_is_refused_to_a_restricted_token(world):
    """It aggregates every visible project into one figure per person, so there is
    no project id left in the answer to narrow. Refused rather than filtered."""
    restricted, _ = issue_token(
        world["owner"], world["workspace"], project_ids=[str(world["projects"]["TAG"].id)]
    )
    message, error = call(client_for(restricted), "get_workload")
    assert error
    assert "restricted" in message.lower()


def test_workload_is_served_to_an_unrestricted_token(world):
    """The other direction — otherwise the refusal above would be indistinguishable
    from the tool being broken for everybody."""
    secret, _ = issue_token(world["owner"], world["workspace"])
    payload, error = call(client_for(secret), "get_workload")
    assert not error, payload
    assert {row["email"] for row in payload} >= {"owner@arribada.test", "member@arribada.test"}


def test_the_production_module_does_not_import_django_test():
    """`mcp_tools` builds its own WSGIRequest rather than borrowing
    `django.test.RequestFactory`, because importing `django.test` from a running
    server connects a dozen `setting_changed` receivers in a process that is not
    a test.

    A SOURCE GREP, and its limits are worth stating: it cannot prove the module
    graph is clean, only that this file does not name the module. A runtime check
    is impossible here — pytest-django imports `django.test` long before this
    test runs, so `sys.modules` says yes either way. The grep catches the thing
    that actually happens, which is somebody reaching for `RequestFactory` again
    because it is the obvious tool.
    """
    import pathlib

    from plane.arribada import mcp_tools

    source = pathlib.Path(mcp_tools.__file__).read_text(encoding="utf-8")
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith(("import ", "from ")):
            assert "django.test" not in stripped, stripped


# ---------------------------------------------------------------------------
# The plan grant (2026-09-25)
#
# Every refusal below has its service twin, and every service test lands on an
# exact value read back from the database, not on the tool's own claim that it
# wrote something: the tool result is the thing under test, so it cannot be the
# witness too.
# ---------------------------------------------------------------------------


def _plan_token(world, user=None, **kwargs):
    return issue_token(
        user or world["owner"],
        world["workspace"],
        scope=MCPToken.SCOPE_WRITE,
        allow_plan=True,
        **kwargs,
    )[0]


def _open(world, identifier="TAG", **flags):
    """Opt the project in to integration writes, plus any governance flag."""
    ProjectSchedule.objects.update_or_create(
        project=world["projects"][identifier], defaults={"external_edits": True, **flags}
    )


def _item(world):
    return Issue.objects.get(name="Pot the antenna")


def test_every_plan_argument_names_a_guarded_field():
    """The link between the MCP's plan arguments and the product's plan guard.

    A field added to `PLAN_FIELDS` without a decision in `PLAN_ARGS` fails here,
    instead of becoming an argument the grant silently does not cover. The two
    `_id` spellings are the only fields allowed to be absent: they are aliases the
    guard lists so that a caller using either form of an upstream route is caught.
    """
    from plane.arribada.mcp_tools import PLAN_ARGS
    from plane.arribada.plan_guard import PLAN_FIELDS

    assert set(PLAN_ARGS.values()) <= set(PLAN_FIELDS)
    assert set(PLAN_FIELDS) - set(PLAN_ARGS.values()) == {"parent_id", "estimate_point_id"}


def test_a_write_token_without_the_plan_grant_cannot_create_a_dated_item(world):
    _open(world)
    secret = _write_token(world)
    message, error = call(
        client_for(secret),
        "create_work_item",
        {"project": "TAG", "name": "Dated too early", "target_date": "2027-02-01"},
    )
    assert error
    assert "plan grant" in message
    assert "target_date" in message
    assert Issue.objects.filter(name="Dated too early").count() == 0


def test_the_plan_grant_moves_the_dates(world):
    _open(world)
    payload, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "start_date": "2027-02-01", "target_date": "2027-02-19"},
    )
    assert not error, payload
    item = _item(world)
    assert item.start_date.isoformat() == "2027-02-01"
    assert item.target_date.isoformat() == "2027-02-19"
    assert payload["changed"]["target_date"] == "2027-02-19"


def test_a_created_item_carries_its_dates(world):
    _open(world)
    payload, error = call(
        client_for(_plan_token(world)),
        "create_work_item",
        {"project": "TAG", "name": "Field test", "start_date": "2027-03-01", "target_date": "2027-03-12"},
    )
    assert not error, payload
    created = Issue.objects.get(name="Field test")
    assert created.target_date.isoformat() == "2027-03-12"
    assert payload["plan"]["start_date"] == "2027-03-01"


def test_a_start_after_the_existing_target_is_refused_and_nothing_moves(world):
    """Checked on the FINAL pair: a start moved alone can cross a target that
    was already there, which is the case a per-request check misses."""
    _open(world)
    Issue.objects.filter(id=_item(world).id).update(target_date="2027-01-10")
    message, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "start_date": "2027-02-01", "priority": "urgent"},
    )
    assert error
    assert "after target_date" in message
    item = _item(world)
    assert item.start_date is None
    # The priority in the same call did not land either: one call, one answer.
    assert item.priority != "urgent"


def test_a_date_can_be_cleared(world):
    _open(world)
    Issue.objects.filter(id=_item(world).id).update(target_date="2027-01-10")
    payload, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "target_date": None},
    )
    assert not error, payload
    assert _item(world).target_date is None


def test_a_parent_is_set_and_a_loop_is_refused(world):
    _open(world)
    secret = _plan_token(world)
    created, error = call(
        client_for(secret), "create_work_item", {"project": "TAG", "name": "Child", "parent": "TAG-1"}
    )
    assert not error, created
    child = Issue.objects.get(name="Child")
    assert child.parent_id == _item(world).id

    message, error = call(
        client_for(secret),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "parent": created["reference"]},
    )
    assert error
    assert "loop" in message
    assert _item(world).parent_id is None

    message, error = call(
        client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "parent": "TAG-1"}
    )
    assert error
    assert "own parent" in message


def _cycle(world, name, days=30):
    now = timezone.now()
    return Cycle.objects.create(
        name=name,
        project=world["projects"]["TAG"],
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=days),
        owned_by=world["owner"],
    )


def test_a_sprint_replaces_the_previous_one(world):
    _open(world)
    first, second = _cycle(world, "Sprint 1"), _cycle(world, "Sprint 2")
    secret = _plan_token(world)
    item = _item(world)

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "sprint": "Sprint 1"})
    assert not error
    assert list(CycleIssue.objects.filter(issue=item).values_list("cycle_id", flat=True)) == [first.id]

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "sprint": "Sprint 2"})
    assert not error
    assert list(CycleIssue.objects.filter(issue=item).values_list("cycle_id", flat=True)) == [second.id]
    # Soft-deleted, as Plane's own viewset does, so the history is still there.
    assert CycleIssue.all_objects.filter(issue=item, cycle=first, deleted_at__isnull=False).count() == 1

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "sprint": None})
    assert not error
    assert CycleIssue.objects.filter(issue=item).count() == 0


def test_a_finished_sprint_is_refused(world):
    _open(world)
    _cycle(world, "Old sprint", days=-2)
    message, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "sprint": "Old sprint"},
    )
    assert error
    assert "finished sprint" in message
    assert CycleIssue.objects.filter(issue=_item(world)).count() == 0


def test_modules_replace_membership(world):
    _open(world)
    tag = world["projects"]["TAG"]
    Module.objects.create(name="Antenna", project=tag)
    Module.objects.create(name="Housing", project=tag)
    secret = _plan_token(world)
    item = _item(world)

    def names():
        return sorted(ModuleIssue.objects.filter(issue=item).values_list("module__name", flat=True))

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "modules": ["Antenna", "Housing"]})
    assert not error
    assert names() == ["Antenna", "Housing"]

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "modules": ["Housing"]})
    assert not error
    assert names() == ["Housing"]

    _, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "modules": []})
    assert not error
    assert names() == []


def test_an_estimate_lands_on_the_projects_scale(world):
    _open(world)
    tag = world["projects"]["TAG"]
    scale = Estimate.objects.create(name="Points", project=tag, type="points")
    for key, value in ((0, "1"), (1, "3"), (2, "5")):
        EstimatePoint.objects.create(estimate=scale, project=tag, key=key, value=value)
    Project.objects.filter(id=tag.id).update(estimate=scale)

    payload, error = call(
        client_for(_plan_token(world)), "update_work_item", {"project": "TAG", "item": "TAG-1", "estimate": "5"}
    )
    assert not error, payload
    assert _item(world).estimate_point.value == "5"

    message, error = call(
        client_for(_plan_token(world)), "update_work_item", {"project": "TAG", "item": "TAG-1", "estimate": "8"}
    )
    assert error
    assert "1, 3, 5" in message


def test_an_estimate_on_a_project_with_no_scale_says_so(world):
    _open(world)
    message, error = call(
        client_for(_plan_token(world)), "update_work_item", {"project": "TAG", "item": "TAG-1", "estimate": "5"}
    )
    assert error
    assert "no estimate scale" in message


def test_a_bad_sprint_refuses_the_whole_call(world):
    """The state in the same call must not land: the agent would read the error
    and retry, and a half-applied first attempt is a second change nobody asked for."""
    _open(world)
    message, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "state": "In progress", "sprint": "No such sprint"},
    )
    assert error
    assert "No sprint called" in message
    assert _item(world).state.name == "Backlog"


def test_lead_only_edits_refuses_a_member_holding_the_grant(world):
    _open(world, lead_only_edits=True)
    secret = _plan_token(world, world["member"])
    message, error = call(
        client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "target_date": "2027-02-19"}
    )
    assert error
    assert "only its lead" in message
    assert _item(world).target_date is None

    # The same member, the same token, a non-plan field: the plan guard is about
    # the plan, not about the member.
    payload, error = call(client_for(secret), "update_work_item", {"project": "TAG", "item": "TAG-1", "priority": "high"})
    assert not error, payload
    assert _item(world).priority == "high"


def test_lead_only_edits_admits_the_lead(world):
    """The service half of the test above, for a member who IS the lead."""
    _open(world, lead_only_edits=True)
    Project.objects.filter(id=world["projects"]["TAG"].id).update(project_lead=world["member"])
    payload, error = call(
        client_for(_plan_token(world, world["member"])),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "target_date": "2027-02-19"},
    )
    assert not error, payload
    assert _item(world).target_date.isoformat() == "2027-02-19"


def test_lead_only_edits_admits_a_workspace_admin_who_is_not_the_lead(world):
    """`_may_edit_plan`'s repair path, asked by name: the same answer the gantt gets."""
    _open(world, lead_only_edits=True)
    Project.objects.filter(id=world["projects"]["TAG"].id).update(project_lead=world["member"])
    payload, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "target_date": "2027-02-20"},
    )
    assert not error, payload
    assert _item(world).target_date.isoformat() == "2027-02-20"


def test_a_locked_timeline_refuses_the_plan_even_to_an_admin(world):
    _open(world, timeline_locked=True)
    message, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "target_date": "2027-02-19"},
    )
    assert error
    assert "locked" in message
    assert _item(world).target_date is None


def test_an_unknown_write_argument_is_refused_not_ignored(world):
    _open(world)
    message, error = call(
        client_for(_plan_token(world)),
        "update_work_item",
        {"project": "TAG", "item": "TAG-1", "parent_id": "TAG-1", "priority": "urgent"},
    )
    assert error
    assert "parent_id" in message
    assert _item(world).priority != "urgent"


def test_whoami_states_the_plan_grant(world):
    with_plan, error = call(client_for(_plan_token(world)), "whoami")
    assert not error
    assert with_plan["token"]["may_write_plan"] is True

    without, error = call(client_for(_write_token(world)), "whoami")
    assert not error
    assert without["token"]["may_write_plan"] is False
    # A token pasted into a config file does not renew, and must not say it does.
    assert without["token"]["renews_automatically"] is False
    assert without["token"]["renewable_until"] is None


def test_whoami_says_a_connector_token_renews_itself(world):
    secret, token = issue_token(
        world["owner"],
        world["workspace"],
        kind=MCPToken.KIND_OAUTH,
        expires_at=timezone.now() + timedelta(hours=24),
        refresh_expires_at=timezone.now() + timedelta(days=180),
    )
    payload, error = call(client_for(secret), "whoami")
    assert not error
    assert payload["token"]["renews_automatically"] is True
    assert payload["token"]["renewable_until"] == token.refresh_expires_at.isoformat()
    assert "not a deadline" in payload["note"]


def test_the_write_tools_advertise_the_plan_arguments(world):
    body = rpc(client_for(_plan_token(world)), "tools/list").json()
    tools = {t["name"]: t for t in body["result"]["tools"]}
    for name in ("create_work_item", "update_work_item"):
        props = tools[name]["inputSchema"]["properties"]
        for arg in ("start_date", "target_date", "parent", "estimate", "sprint", "modules"):
            assert arg in props, (name, arg)
