# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The OAuth 2.1 flow, end to end, and the four ways it must refuse.

The whole flow is walked here — register, authorize, consent, exchange, call
the MCP endpoint with the issued token — because every piece of it can be
individually correct and the chain still not work, and the only thing the user
cares about is the chain. `test_the_whole_flow_issues_a_token_that_works` is
the one to read first.

The refusals each have a service test beside them, for the usual reason: a
check that only proves denial passes against an endpoint that refuses everyone.

THE FOUR THAT MATTER, and why each is not a formality:

  redirect_uri not registered -> a PAGE, never a redirect. This is the open
      redirector. Getting the ORDER wrong (reporting the error by redirecting
      to the URI being complained about) turns a trusted hostname into a
      bounce for whatever a phisher put in the query string.
  wrong PKCE verifier -> refused. Without it, anyone who intercepts the code
      in a callback URL redeems it.
  code replayed -> refused, and refused by a conditional UPDATE rather than a
      read-then-write, so two simultaneous requests have exactly one winner.
  refresh rotated -> the old refresh token stops working the moment it is used.
"""

import base64
import hashlib
import json
import secrets

import pytest
from django.test import Client
from django.utils import timezone

from plane.app.permissions import ROLE
from plane.arribada import mcp_oauth as oauth
from plane.arribada.models import MCPAuthorizationCode, MCPOAuthClient, MCPToken
from plane.db.models import Project, ProjectMember, State, User, Workspace, WorkspaceMember

REDIRECT = "http://localhost:54321/callback"


@pytest.fixture
def world(db):
    owner = User.objects.create(email="oauth@arribada.test", username="oauth-owner", first_name="Oauth")
    workspace = Workspace.objects.create(name="OAuth", owner=owner, slug="oauth-fixture")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(
        name="Turtle tag", workspace=workspace, created_by=owner, identifier="TAG"
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
    )
    State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    return {"user": owner, "workspace": workspace, "project": project}


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return verifier, challenge


def make_client(client, name="Claude", uris=None):
    response = client.post(
        "/oauth/register",
        data=json.dumps({"client_name": name, "redirect_uris": uris or [REDIRECT]}),
        content_type="application/json",
    )
    assert response.status_code == 201, response.content
    return response.json()


def authorize_params(client_id, challenge, **extra):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "xyz",
    }
    params.update(extra)
    return params


def code_from(response):
    """Pull the authorization code out of the 302 the consent POST returns."""
    from urllib.parse import parse_qs, urlparse

    assert response.status_code == 302, response.content
    return parse_qs(urlparse(response["Location"]).query)["code"][0]


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def test_the_two_discovery_documents_are_json_not_the_spa(client, world):
    """The bug that started this: these paths used to answer 200 with the web
    app's HTML, so a client asking for JSON got a page and reported something
    unrelated."""
    for path in ("/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response["Content-Type"].startswith("application/json"), (path, response["Content-Type"])
        json.loads(response.content)


def test_the_metadata_says_what_a_client_needs(client, world):
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["authorization_endpoint"].endswith("/oauth/authorize")
    assert meta["token_endpoint"].endswith("/oauth/token")
    assert meta["registration_endpoint"].endswith("/oauth/register")
    assert meta["code_challenge_methods_supported"] == ["S256"]  # never `plain`
    assert meta["grant_types_supported"] == ["authorization_code", "refresh_token"]

    resource = client.get("/.well-known/oauth-protected-resource").json()
    assert resource["resource"].endswith("/api/arribada/mcp/")
    assert resource["authorization_servers"] == [meta["issuer"]]


def test_the_path_suffixed_well_known_form_answers_too(client, world):
    """RFC 9728 inserts the resource path into the URL. Clients differ on which
    form they try; a 404 on this one reads as "no OAuth here"."""
    response = client.get("/.well-known/oauth-protected-resource/api/arribada/mcp")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/json")


def test_the_401_points_at_the_discovery_document(client, world):
    """Without `resource_metadata=` a client has a 401 and nowhere to go."""
    response = client.post(
        "/api/arribada/mcp/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
    )
    assert response.status_code == 401
    header = response.headers["WWW-Authenticate"]
    assert "resource_metadata=" in header
    assert "/.well-known/oauth-protected-resource" in header


def test_the_mcp_endpoint_answers_without_a_trailing_slash(client, world):
    """Found in the production proxy log as a 404, not imagined."""
    response = client.post(
        "/api/arribada/mcp",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
    )
    assert response.status_code == 401  # reached the view; refused for lack of a token


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def test_a_client_can_register_itself(client, world):
    body = make_client(client)
    assert body["token_endpoint_auth_method"] == "none"
    assert body["redirect_uris"] == [REDIRECT]
    assert MCPOAuthClient.objects.filter(client_id=body["client_id"]).exists()


@pytest.mark.parametrize(
    "uri",
    [
        "http://evil.test/cb",  # plain http off-loopback
        "javascript:alert(1)",
        "not a uri",
        "",
    ],
)
def test_unacceptable_redirect_uris_are_refused_at_registration(client, world, uri):
    response = client.post(
        "/oauth/register",
        data=json.dumps({"client_name": "x", "redirect_uris": [uri]}),
        content_type="application/json",
    )
    assert response.status_code == 400, uri
    assert response.json()["error"] == "invalid_redirect_uri"


@pytest.mark.parametrize(
    "uri",
    ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:8976/cb", "com.example.app:/cb"],
)
def test_the_three_legitimate_redirect_shapes_are_accepted(client, world, uri):
    """The service half — otherwise the refusals above would pass against a
    validator that rejects everything."""
    response = client.post(
        "/oauth/register",
        data=json.dumps({"client_name": "x", "redirect_uris": [uri]}),
        content_type="application/json",
    )
    assert response.status_code == 201, (uri, response.content)


# ---------------------------------------------------------------------------
# Authorize — the open-redirect guard
# ---------------------------------------------------------------------------


def test_an_unregistered_redirect_uri_gets_a_page_never_a_redirect(client, world):
    """THE open-redirect test. If this ever starts returning a 302, this
    endpoint has become a bounce for whatever a phisher puts in the URL."""
    registered = make_client(client)
    _verifier, challenge = pkce()
    client.force_login(world["user"])
    response = client.get(
        "/oauth/authorize",
        authorize_params(registered["client_id"], challenge, redirect_uri="https://evil.test/steal"),
    )
    assert response.status_code == 400
    assert response["Content-Type"].startswith("text/html")
    assert "Location" not in response


def test_an_unknown_client_gets_a_page_never_a_redirect(client, world):
    _verifier, challenge = pkce()
    client.force_login(world["user"])
    response = client.get("/oauth/authorize", authorize_params("no-such-client", challenge))
    assert response.status_code == 400
    assert "Location" not in response


def test_a_registered_redirect_uri_reaches_the_consent_screen(client, world):
    """The service half of both tests above."""
    registered = make_client(client)
    _verifier, challenge = pkce()
    client.force_login(world["user"])
    response = client.get("/oauth/authorize", authorize_params(registered["client_id"], challenge))
    assert response.status_code == 200
    body = response.content.decode()
    assert "Authorise" in body and "Claude" in body
    assert "oauth@arribada.test" in body  # says who is about to grant it


def test_an_anonymous_visitor_is_sent_to_planes_own_sign_in(client, world):
    """And the whole authorize request survives the round trip — losing the
    query string here is how this flow ends on a blank page."""
    registered = make_client(client)
    _verifier, challenge = pkce()
    response = client.get("/oauth/authorize", authorize_params(registered["client_id"], challenge))
    assert response.status_code == 302
    assert "next_path" in response["Location"]
    assert "code_challenge" in response["Location"]


def test_pkce_is_required_and_plain_is_not_enough(client, world):
    registered = make_client(client)
    client.force_login(world["user"])
    response = client.get(
        "/oauth/authorize",
        authorize_params(registered["client_id"], "abc", code_challenge_method="plain"),
    )
    assert response.status_code == 302
    assert "error=invalid_request" in response["Location"]
    assert response["Location"].startswith(REDIRECT)  # reported to the client, correctly


def test_declining_sends_access_denied_and_mints_nothing(client, world):
    registered = make_client(client)
    _verifier, challenge = pkce()
    client.force_login(world["user"])
    params = authorize_params(registered["client_id"], challenge)
    params["decision"] = "deny"
    response = client.post("/oauth/authorize", params)
    assert response.status_code == 302
    assert "error=access_denied" in response["Location"]
    assert MCPAuthorizationCode.objects.count() == 0


# ---------------------------------------------------------------------------
# The whole flow
# ---------------------------------------------------------------------------


def _consent(client, registered, challenge, grants=("read",)):
    params = authorize_params(registered["client_id"], challenge)
    params["decision"] = "allow"
    params["grant"] = list(grants)
    return client.post("/oauth/authorize", params)


def test_the_whole_flow_issues_a_token_that_works(client, world):
    """Register -> authorize -> consent -> exchange -> call the MCP server.

    The last assertion is the one that matters: the token this flow produced is
    accepted by `MCPTokenAuthentication` with no special-casing, because it is
    an ordinary `MCPToken` row.
    """
    registered = make_client(client)
    verifier, challenge = pkce()
    client.force_login(world["user"])

    code = code_from(_consent(client, registered, challenge))

    exchanged = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    )
    assert exchanged.status_code == 200, exchanged.content
    body = exchanged.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 24 * 3600
    assert exchanged["Cache-Control"] == "no-store"

    # The access token is one of ours, and it drives the MCP server.
    fresh = Client()  # no session — prove it is the TOKEN doing the work, not the login
    called = fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami", "arguments": {}}}
        ),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {body['access_token']}",
    )
    assert called.status_code == 200, called.content
    result = called.json()["result"]
    assert not result.get("isError"), result
    payload = json.loads(result["content"][0]["text"])
    assert payload["user"]["email"] == "oauth@arribada.test"
    assert payload["token"]["scope"] == "read"
    assert payload["token"]["may_read_money"] is False


def test_the_consent_screen_decides_the_grant_not_the_client(client, world):
    """Tick finance and write, and the minted token carries them. The client's
    `scope` parameter is a request; the checkbox is the decision."""
    registered = make_client(client)
    verifier, challenge = pkce()
    client.force_login(world["user"])
    code = code_from(_consent(client, registered, challenge, grants=("read", "finance", "write")))

    body = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    ).json()
    minted = MCPToken.objects.get(token_hash__isnull=False, kind=MCPToken.KIND_OAUTH)
    assert minted.scope == MCPToken.SCOPE_WRITE
    assert minted.allow_money is True
    assert oauth.SCOPE_FINANCE in body["scope"]


def test_ticking_nothing_extra_grants_nothing_extra(client, world):
    """The floor. `read` is the only thing a consent with no boxes ticked can
    produce — and it must still produce that, or the connector is useless."""
    registered = make_client(client)
    verifier, challenge = pkce()
    client.force_login(world["user"])
    code = code_from(_consent(client, registered, challenge, grants=()))
    client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    )
    minted = MCPToken.objects.get(kind=MCPToken.KIND_OAUTH)
    assert minted.scope == MCPToken.SCOPE_READ
    assert minted.allow_money is False


# ---------------------------------------------------------------------------
# Token endpoint refusals
# ---------------------------------------------------------------------------


def _code_and_verifier(client, world):
    registered = make_client(client)
    verifier, challenge = pkce()
    client.force_login(world["user"])
    return registered, verifier, code_from(_consent(client, registered, challenge))


def test_the_wrong_pkce_verifier_is_refused(client, world):
    registered, _verifier, code = _code_and_verifier(client, world)
    response = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": secrets.token_urlsafe(48),  # not the one
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"
    assert MCPToken.objects.filter(kind=MCPToken.KIND_OAUTH).count() == 0


def test_a_code_cannot_be_used_twice(client, world):
    registered, verifier, code = _code_and_verifier(client, world)
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "client_id": registered["client_id"],
        "redirect_uri": REDIRECT,
    }
    assert client.post("/oauth/token", payload).status_code == 200  # positive control
    replayed = client.post("/oauth/token", payload)
    assert replayed.status_code == 400
    assert replayed.json()["error"] == "invalid_grant"
    assert MCPToken.objects.filter(kind=MCPToken.KIND_OAUTH).count() == 1


def test_a_code_cannot_be_redeemed_by_a_different_client(client, world):
    registered, verifier, code = _code_and_verifier(client, world)
    other = make_client(client, name="Impostor")
    response = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": other["client_id"],
            "redirect_uri": REDIRECT,
        },
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"


def test_an_expired_code_is_refused(client, world):
    from datetime import timedelta

    registered, verifier, code = _code_and_verifier(client, world)
    MCPAuthorizationCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    response = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------


def _issued(client, world):
    registered, verifier, code = _code_and_verifier(client, world)
    body = client.post(
        "/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": REDIRECT,
        },
    ).json()
    return registered, body


def test_a_refresh_token_yields_a_working_access_token(client, world):
    registered, body = _issued(client, world)
    refreshed = client.post(
        "/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": body["refresh_token"],
            "client_id": registered["client_id"],
        },
    )
    assert refreshed.status_code == 200, refreshed.content
    new = refreshed.json()
    assert new["access_token"] != body["access_token"]

    fresh = Client()
    called = fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {new['access_token']}",
    )
    assert called.status_code == 200


def test_the_refresh_token_rotates_and_the_old_one_dies(client, world):
    registered, body = _issued(client, world)
    first = client.post(
        "/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": body["refresh_token"],
            "client_id": registered["client_id"],
        },
    )
    assert first.status_code == 200
    assert first.json()["refresh_token"] != body["refresh_token"]

    replay = client.post(
        "/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": body["refresh_token"],  # the spent one
            "client_id": registered["client_id"],
        },
    )
    assert replay.status_code == 400
    assert replay.json()["error"] == "invalid_grant"


def test_rotating_revokes_the_old_access_token_too(client, world):
    registered, body = _issued(client, world)
    client.post(
        "/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": body["refresh_token"],
            "client_id": registered["client_id"],
        },
    )
    fresh = Client()
    called = fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {body['access_token']}",
    )
    assert called.status_code == 401


def test_a_refresh_token_is_not_a_bearer_token(client, world):
    """`arb_mcpr_` deliberately does not start with `arb_mcp_`, so a refresh
    token sent as a bearer is refused by the prefix check before any query."""
    _registered, body = _issued(client, world)
    assert body["refresh_token"].startswith("arb_mcpr_")
    assert not body["refresh_token"].startswith("arb_mcp_")
    fresh = Client()
    called = fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {body['refresh_token']}",
    )
    assert called.status_code == 401


def test_a_refresh_token_cannot_be_redeemed_by_another_client(client, world):
    _registered, body = _issued(client, world)
    other = make_client(client, name="Impostor")
    response = client.post(
        "/oauth/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": body["refresh_token"],
            "client_id": other["client_id"],
        },
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# The OAuth token is attenuated by the same gates as every other token
# ---------------------------------------------------------------------------


def test_an_oauth_token_without_finance_is_refused_the_money(client, world):
    _registered, body = _issued(client, world)  # consented to read only
    fresh = Client()
    called = fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_project_budget", "arguments": {"project": "TAG"}},
            }
        ),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {body['access_token']}",
    )
    result = called.json()["result"]
    assert result["isError"] is True
    assert "finance" in result["content"][0]["text"].lower()


def test_an_oauth_call_is_written_to_the_same_audit_log(client, world):
    from plane.arribada.models import MCPCallLog

    _registered, body = _issued(client, world)
    fresh = Client()
    fresh.post(
        "/api/arribada/mcp/",
        data=json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami", "arguments": {}}}
        ),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {body['access_token']}",
    )
    row = MCPCallLog.objects.filter(tool="whoami").first()
    assert row is not None and row.ok
    assert row.token.kind == MCPToken.KIND_OAUTH


# ---------------------------------------------------------------------------
# CSRF on the consent form
#
# THE TEST THAT WAS MISSING. The first version of the consent screen rendered no
# `csrfmiddlewaretoken` at all, and every test above still passed — because
# `django.test.Client` disables CSRF enforcement by default. The flow would have
# 403'd the moment a real browser pressed Authorise: at the last step, after the
# user had already made the decision, with nothing in any log to explain it.
#
# So these two run under `Client(enforce_csrf_checks=True)`, which is what a
# browser actually meets.
# ---------------------------------------------------------------------------


def test_the_consent_form_carries_a_csrf_token(world):
    """And the POST it produces is accepted with CSRF enforced."""
    strict = Client(enforce_csrf_checks=True)
    registered = make_client(strict)
    verifier, challenge = pkce()
    strict.force_login(world["user"])

    page = strict.get("/oauth/authorize", authorize_params(registered["client_id"], challenge))
    assert page.status_code == 200
    body = page.content.decode()
    assert 'name="csrfmiddlewaretoken"' in body

    import re

    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body).group(1)
    params = authorize_params(registered["client_id"], challenge)
    params["decision"] = "allow"
    params["grant"] = ["read"]
    params["csrfmiddlewaretoken"] = token
    submitted = strict.post("/oauth/authorize", params)
    assert submitted.status_code == 302, submitted.content
    assert "code=" in submitted["Location"]


def test_a_csrf_failure_reports_403_and_still_grants_nothing(world):
    """Upstream answered 200 to a request it had just refused, so any caller
    judging by the status code was told the write succeeded. This asserts BOTH
    halves — the status, which is what was wrong, and the effect, which is what
    matters. An earlier version of this test asserted only the 200 and
    documented it as an upstream quirk; the quirk is now fixed."""
    strict = Client(enforce_csrf_checks=True)
    registered = make_client(strict)
    _verifier, challenge = pkce()
    strict.force_login(world["user"])

    params = authorize_params(registered["client_id"], challenge)
    params["decision"] = "allow"
    params["grant"] = ["read"]
    forged = strict.post("/oauth/authorize", params)  # no csrfmiddlewaretoken

    assert forged.status_code == 403
    assert MCPAuthorizationCode.objects.count() == 0
    assert MCPToken.objects.filter(kind=MCPToken.KIND_OAUTH).count() == 0


# ---------------------------------------------------------------------------
# Revocation, and the page a person uses
#
# Built because the flow above let anybody on the team authorise a connector
# from a browser while revoking one still needed a shell on the droplet. A grant
# a person can give and cannot take back is not a grant they control.
# ---------------------------------------------------------------------------


def test_the_metadata_advertises_the_revocation_endpoint(client, world):
    """A client that cannot discover it will never call it."""
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["revocation_endpoint"].endswith("/oauth/revoke")


def _mcp_call(access_token):
    """Drive the MCP endpoint with a bare client — no session, so the token is
    the only thing that can be doing the work."""
    return Client().post(
        "/api/arribada/mcp/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {access_token}",
    )


def test_revoking_an_access_token_kills_it(client, world):
    registered, body = _issued(client, world)
    assert _mcp_call(body["access_token"]).status_code == 200  # positive control

    revoked = client.post(
        "/oauth/revoke", {"token": body["access_token"], "client_id": registered["client_id"]}
    )
    assert revoked.status_code == 200
    assert _mcp_call(body["access_token"]).status_code == 401


def test_revoking_the_refresh_token_kills_the_access_token_too(client, world):
    """They are one row, so naming either ends both — which is what RFC 7009
    says SHOULD happen and what a client expects."""
    registered, body = _issued(client, world)
    assert _mcp_call(body["access_token"]).status_code == 200

    assert client.post(
        "/oauth/revoke", {"token": body["refresh_token"], "client_id": registered["client_id"]}
    ).status_code == 200
    assert _mcp_call(body["access_token"]).status_code == 401


def test_revocation_answers_200_for_a_token_that_does_not_exist(client, world):
    """RFC 7009, and the right rule: an endpoint that said "no such token" would
    be an unauthenticated oracle for whether a string is a live credential."""
    registered = make_client(client)
    response = client.post(
        "/oauth/revoke", {"token": "arb_mcp_" + "0" * 64, "client_id": registered["client_id"]}
    )
    assert response.status_code == 200


def test_one_client_cannot_revoke_another_clients_token(client, world):
    """Registration is open. Without this scoping, any registered client could
    cut anybody's integration by presenting a token it had seen."""
    _registered, body = _issued(client, world)
    impostor = make_client(client, name="Impostor")

    assert client.post(
        "/oauth/revoke", {"token": body["access_token"], "client_id": impostor["client_id"]}
    ).status_code == 200  # the RFC says 200 regardless of what happened

    assert _mcp_call(body["access_token"]).status_code == 200  # untouched


def test_the_connections_page_lists_what_this_account_authorised(client, world):
    _registered, _body = _issued(client, world)
    client.force_login(world["user"])
    page = client.get("/oauth/connections")
    assert page.status_code == 200
    body = page.content.decode()
    assert "Connected apps" in body
    assert "Claude" in body
    assert 'name="csrfmiddlewaretoken"' in body
    assert "Revoke" in body


def test_the_connections_page_revokes_and_the_token_dies(client, world):
    _registered, body = _issued(client, world)
    token_id = str(MCPToken.objects.get(kind=MCPToken.KIND_OAUTH).id)
    client.force_login(world["user"])

    done = client.post("/oauth/connections", {"revoke": token_id})
    assert done.status_code == 200
    assert b"Revoked" in done.content
    assert _mcp_call(body["access_token"]).status_code == 401


def test_you_cannot_revoke_somebody_elses_grant_from_that_page(client, world):
    """Scoped by the queryset, not by trusting the id in the form."""
    from plane.db.models import User, WorkspaceMember

    _registered, body = _issued(client, world)
    mine = MCPToken.objects.get(kind=MCPToken.KIND_OAUTH)

    stranger = User.objects.create(
        email="stranger@arribada.test", username="stranger", first_name="Stranger"
    )
    WorkspaceMember.objects.create(
        workspace=world["workspace"], member=stranger, role=ROLE.MEMBER.value
    )
    other = Client()
    other.force_login(stranger)
    other.post("/oauth/connections", {"revoke": str(mine.id)})

    mine.refresh_from_db()
    assert mine.revoked_at is None
    assert _mcp_call(body["access_token"]).status_code == 200


def test_a_junk_id_on_that_page_is_a_no_op_not_a_500(client, world):
    """`MCPToken.pk` is a UUIDField, so filtering it on a non-uuid raises rather
    than matching nothing — on the page whose job is to work when something has
    already gone wrong."""
    _registered, _body = _issued(client, world)
    client.force_login(world["user"])
    response = client.post("/oauth/connections", {"revoke": "not-a-uuid"})
    assert response.status_code == 200
    assert MCPToken.objects.filter(revoked_at__isnull=False).count() == 0


def test_the_connections_page_sends_a_stranger_to_sign_in(client, world):
    response = client.get("/oauth/connections")
    assert response.status_code == 302
    assert "next_path" in response["Location"]
