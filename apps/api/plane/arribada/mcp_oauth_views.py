# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The OAuth 2.1 endpoints, mounted at the domain root.

Plain Django views rather than DRF, on purpose: `/oauth/authorize` renders HTML
for a human and reads `request.user` from the session middleware, and the token
and registration endpoints speak form-encoded and JSON respectively with no
authentication of their own. DRF would add a renderer, a parser and an
authentication stack that all have to be switched off again.

THE ORDER OF VALIDATION ON `/authorize` IS THE SECURITY OF THIS FILE, and it is
the one thing to preserve if any of this is ever edited:

  1. Resolve the client. Unknown client -> a plain error page. Never a redirect.
  2. Match `redirect_uri` against that client's registered allow-list, exactly.
     Not on the list -> a plain error page. STILL never a redirect.
  3. Only now may anything be reported by redirecting, because only now do we
     know the destination is one the client itself registered.

Reversing 2 and 3 turns this endpoint into an open redirector that bounces
anybody anywhere with a trustworthy hostname in front of it, and the resulting
URL carries whatever a phisher put in it. Every error below chooses one of the
two paths deliberately; `_bad_request` is the pre-validation one.
"""

import json

from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.html import escape
from django.views.decorators.clickjacking import xframe_options_deny
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import mcp_oauth as oauth
from .models import MCPOAuthClient, MCPToken

# Registration is unauthenticated by protocol, so it gets a ceiling. Per IP,
# fixed window. FAILS OPEN on a cache outage, same trade-off and same reasoning
# as the MCP rate limit: the thing being prevented is a junk table, not a
# break-in, because a registration grants nothing without a human afterwards.
REGISTER_LIMIT = 20
REGISTER_WINDOW = 3600


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _register_limited(request):
    from django.core.cache import cache

    ip = _client_ip(request) or "unknown"
    key = f"mcp-oauth-register:{ip}:{int(timezone.now().timestamp() // REGISTER_WINDOW)}"
    try:
        cache.get_or_set(key, 0, REGISTER_WINDOW)
        count = cache.incr(key)
    except Exception:  # noqa: BLE001
        return False
    return count is not None and count > REGISTER_LIMIT


def _page(title, message, status=400):
    """The error path for anything that must NOT redirect."""
    return HttpResponse(
        f"""<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{escape(title)}</title>
<style>:root{{color-scheme:light dark}}body{{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f7f9;color:#14181f}}
@media(prefers-color-scheme:dark){{body{{background:#0f1216;color:#e6e9ee}}}}
.card{{max-width:440px;padding:28px;background:#fff;border-radius:12px;
box-shadow:0 1px 3px rgba(0,0,0,.12)}}@media(prefers-color-scheme:dark){{.card{{background:#171b21;
box-shadow:none;border:1px solid #262c35}}}}h1{{font-size:17px;margin:0 0 8px}}p{{margin:0;color:#6b7280}}</style>
</head><body><div class="card"><h1>{escape(title)}</h1><p>{escape(message)}</p></div></body></html>""",
        status=status,
        content_type="text/html; charset=utf-8",
    )


def _oauth_error(error, description, status=400):
    return JsonResponse({"error": error, "error_description": description}, status=status)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


@require_GET
def protected_resource_metadata(request, suffix=None):
    """RFC 9728, at the bare path and at the path-suffixed form.

    `suffix` exists because RFC 9728 inserts the resource's path INTO the
    well-known URL, so a client looking for `/api/arribada/mcp/` asks for
    `/.well-known/oauth-protected-resource/api/arribada/mcp`. Clients differ on
    which one they try; answering both costs one route.
    """
    return JsonResponse(oauth.protected_resource_metadata(oauth.base_url(request)))


@require_GET
def authorization_server_metadata(request, suffix=None):
    return JsonResponse(oauth.authorization_server_metadata(oauth.base_url(request)))


# ---------------------------------------------------------------------------
# Dynamic Client Registration (RFC 7591)
# ---------------------------------------------------------------------------


@csrf_exempt
@require_POST
def register(request):
    if _register_limited(request):
        return _oauth_error("temporarily_unavailable", "Too many registrations from this address.", 429)

    try:
        body = json.loads(request.body.decode("utf-8", "replace") or "{}")
    except ValueError:
        return _oauth_error("invalid_client_metadata", "Body must be JSON.")
    if not isinstance(body, dict):
        return _oauth_error("invalid_client_metadata", "Body must be a JSON object.")

    uris = body.get("redirect_uris")
    if not isinstance(uris, list) or not uris:
        return _oauth_error("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array.")
    if len(uris) > 10:
        return _oauth_error("invalid_redirect_uri", "At most 10 redirect_uris.")
    for uri in uris:
        if not isinstance(uri, str) or not oauth.redirect_uri_is_acceptable(uri):
            return _oauth_error(
                "invalid_redirect_uri",
                f"Not an acceptable redirect URI: {uri!r}. Use https, http on loopback, or a custom scheme.",
            )

    client = oauth.register_client(
        name=body.get("client_name") or "",
        redirect_uris=uris,
        ip=_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )
    return JsonResponse(
        {
            "client_id": client.client_id,
            "client_id_issued_at": int(client.created_at.timestamp()),
            "client_name": client.client_name,
            "redirect_uris": client.redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            # No secret, and none is expected: every client here is public and
            # PKCE is what authenticates the exchange.
            "token_endpoint_auth_method": "none",
        },
        status=201,
    )


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


def _read_params(source):
    keys = (
        "response_type",
        "client_id",
        "redirect_uri",
        "code_challenge",
        "code_challenge_method",
        "state",
        "scope",
        "resource",
    )
    return {k: (source.get(k) or "").strip() for k in keys}


def _resolve_client_and_redirect(params):
    """Steps 1 and 2. Returns (client, error_page) — exactly one is None."""
    client_id = params.get("client_id")
    if not client_id:
        return None, _page("Invalid request", "No client_id was supplied.")
    client = MCPOAuthClient.objects.filter(client_id=client_id).first()
    if client is None:
        return None, _page(
            "Unknown application",
            "This application is not registered with Arribada Plane. It may need to register again.",
        )
    redirect_uri = params.get("redirect_uri")
    if not redirect_uri:
        return None, _page("Invalid request", "No redirect_uri was supplied.")
    if not client.allows_redirect(redirect_uri):
        # Deliberately NOT redirected. This is the open-redirect guard.
        return None, _page(
            "Invalid redirect",
            "This application asked to be sent somewhere it has not registered. Nothing was sent.",
        )
    return client, None


@xframe_options_deny
@require_GET
def authorize_get(request):
    params = _read_params(request.GET)
    client, failure = _resolve_client_and_redirect(params)
    if failure is not None:
        return failure

    # From here a redirect is safe: the destination is the client's own.
    if params["response_type"] != "code":
        return HttpResponseRedirect(
            oauth.error_redirect(
                params["redirect_uri"], "unsupported_response_type",
                "Only the authorization code flow is supported.", params["state"],
            )
        )
    if params["code_challenge_method"] != "S256" or not params["code_challenge"]:
        return HttpResponseRedirect(
            oauth.error_redirect(
                params["redirect_uri"], "invalid_request",
                "PKCE with code_challenge_method=S256 is required.", params["state"],
            )
        )

    base = oauth.base_url(request)
    if not request.user.is_authenticated:
        # Plane's own sign-in, with the whole authorize request as next_path so
        # the consent screen is what the browser comes back to.
        return HttpResponseRedirect(oauth.sign_in_url(base, request))

    requested = set((params["scope"] or "").split())
    # `get_token` both returns the value and marks the response for the cookie,
    # which is what makes the POST below verifiable. Reading `request.META` for
    # an existing token instead would work only for a browser that already had
    # one, which the first visitor does not.
    return HttpResponse(
        oauth.consent_page(base, client, request.user, params, requested, get_token(request)),
        content_type="text/html; charset=utf-8",
    )


@xframe_options_deny
@require_POST
def authorize_post(request):
    """The consent decision.

    CSRF is enforced here by Django's default middleware — this is a real form
    POST from a page this server rendered, so the token is present. That is why
    there is no `csrf_exempt` on this view and why there must never be one: a
    consent screen that can be submitted cross-site is a consent screen that
    grants access without a decision.
    """
    params = _read_params(request.POST)
    client, failure = _resolve_client_and_redirect(params)
    if failure is not None:
        return failure

    if not request.user.is_authenticated:
        return HttpResponseRedirect(oauth.sign_in_url(oauth.base_url(request), request))

    if request.POST.get("decision") != "allow":
        return HttpResponseRedirect(
            oauth.error_redirect(
                params["redirect_uri"], "access_denied",
                "The user declined.", params["state"],
            )
        )

    granted = set(request.POST.getlist("grant"))
    # `read` is not in `granted` when the box is rendered disabled — a disabled
    # checkbox is not submitted. It is the floor of every grant, so it is set
    # here rather than trusted from the form.
    scope = MCPToken.SCOPE_WRITE if "write" in granted else MCPToken.SCOPE_READ
    money = "finance" in granted

    workspace = _workspace_for(request.user)
    if workspace is None:
        return _page(
            "No workspace",
            "This account is not an active member of any workspace, so there is nothing to authorise.",
            status=403,
        )

    code = oauth.issue_code(
        client=client,
        user=request.user,
        workspace=workspace,
        redirect_uri=params["redirect_uri"],
        code_challenge=params["code_challenge"],
        resource=params["resource"],
        scope=scope,
        money=money,
    )
    return HttpResponseRedirect(
        oauth.success_redirect(params["redirect_uri"], code, params["state"])
    )


def _workspace_for(user):
    """The workspace an OAuth token acts in.

    One workspace exists on this instance (`arribada`), so this picks the
    caller's active membership and does not ask. If a second workspace is ever
    added, this is the function that has to grow a choice on the consent screen
    — and it will be obvious, because this returns the wrong one rather than
    failing.
    """
    from plane.db.models import WorkspaceMember

    membership = (
        WorkspaceMember.objects.filter(member=user, is_active=True)
        .select_related("workspace")
        .order_by("created_at")
        .first()
    )
    return membership.workspace if membership else None


# ---------------------------------------------------------------------------
# Token
# ---------------------------------------------------------------------------


@csrf_exempt
@require_POST
def token(request):
    """`authorization_code` and `refresh_token`, form-encoded per the spec.

    CSRF-exempt and correctly so: this is a machine-to-machine call carrying
    its own proof (the code plus the PKCE verifier, or a refresh token), with
    no session and no cookie involved. The consent POST above is the opposite
    case and keeps its protection.
    """
    grant_type = (request.POST.get("grant_type") or "").strip()
    client_id = (request.POST.get("client_id") or "").strip()
    client = MCPOAuthClient.objects.filter(client_id=client_id).first()
    if client is None:
        return _oauth_error("invalid_client", "Unknown client_id.", 401)

    if grant_type == "authorization_code":
        return _authorization_code_grant(request, client)
    if grant_type == "refresh_token":
        return _refresh_grant(request, client)
    return _oauth_error("unsupported_grant_type", f"Unsupported grant_type {grant_type!r}.")


def _authorization_code_grant(request, client):
    code = (request.POST.get("code") or "").strip()
    verifier = (request.POST.get("code_verifier") or "").strip()
    redirect_uri = (request.POST.get("redirect_uri") or "").strip()
    if not code or not verifier:
        return _oauth_error("invalid_request", "code and code_verifier are required.")

    row = oauth.consume_code(code)
    if row is None:
        # One message for "never existed", "already used" and "expired". The
        # difference is not the client's business and telling it apart is an
        # oracle for replay.
        return _oauth_error("invalid_grant", "That authorization code is not usable.")
    if row.client_id != client.id:
        return _oauth_error("invalid_grant", "That code was issued to a different client.")
    if row.redirect_uri != redirect_uri:
        return _oauth_error("invalid_grant", "redirect_uri does not match the one the code was issued for.")
    if not oauth.verify_pkce_s256(verifier, row.code_challenge):
        return _oauth_error("invalid_grant", "PKCE verification failed.")

    access, refresh, minted = oauth.issue_tokens(
        row.user, row.workspace, client, row.granted_scope, row.granted_money
    )
    return _token_response(access, refresh, minted)


def _refresh_grant(request, client):
    refresh = (request.POST.get("refresh_token") or "").strip()
    if not refresh:
        return _oauth_error("invalid_request", "refresh_token is required.")
    issued = oauth.rotate(refresh, client)
    if issued is None:
        return _oauth_error("invalid_grant", "That refresh token is not usable.")
    access, new_refresh, minted = issued
    return _token_response(access, new_refresh, minted)


def _token_response(access, refresh, minted):
    scopes = [oauth.SCOPE_READ]
    if minted.scope == MCPToken.SCOPE_WRITE:
        scopes.append(oauth.SCOPE_WRITE)
    if minted.allow_money:
        scopes.append(oauth.SCOPE_FINANCE)
    response = JsonResponse(
        {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": int(oauth.ACCESS_TOKEN_TTL.total_seconds()),
            "refresh_token": refresh,
            "scope": " ".join(scopes),
        }
    )
    # Tokens must not sit in any cache between here and the client.
    response["Cache-Control"] = "no-store"
    response["Pragma"] = "no-cache"
    return response


# ---------------------------------------------------------------------------
# Revocation (RFC 7009) and the page a person uses
# ---------------------------------------------------------------------------


@csrf_exempt
@require_POST
def revoke(request):
    """RFC 7009. **Always 200**, whether or not anything was revoked.

    That is the RFC's rule and it is also the right one: an endpoint that said
    "no such token" would let anybody test whether a string is a live
    credential, one guess at a time, unauthenticated.

    `client_id` is required and the revocation is scoped to that client's own
    tokens. Registration is open, so without that scoping any registered client
    could revoke anybody's token by presenting it — a denial of service with a
    very low bar.
    """
    secret = (request.POST.get("token") or "").strip()
    client_id = (request.POST.get("client_id") or "").strip()
    if not secret:
        return _oauth_error("invalid_request", "token is required.")

    client = MCPOAuthClient.objects.filter(client_id=client_id).first() if client_id else None
    if client is None:
        # Unknown or absent client: still 200, still nothing revoked. Same
        # reasoning as above — the answer must not depend on what is true.
        return HttpResponse(status=200)

    oauth.revoke_token(secret, client=client)
    return HttpResponse(status=200)


@xframe_options_deny
def connections(request):
    """`/oauth/connections` — list this account's live grants, and revoke one.

    Session-authenticated like the consent screen, and for the same reason: the
    person doing this is a human in a browser, and the question "who are you" is
    already answered by Plane's own login.

    The POST is a real form post and keeps Django's CSRF protection. There is no
    `csrf_exempt` here and there must never be one — a revoke button that can be
    triggered cross-site is a way to cut somebody's integrations from a forum
    post. (Note that a CSRF failure in this product answers 200; see HANDOVER.md.
    Nothing is revoked, which is the part that matters.)
    """
    base = oauth.base_url(request)
    if not request.user.is_authenticated:
        return HttpResponseRedirect(oauth.sign_in_url(base, request))

    message = ""
    if request.method == "POST":
        wanted = (request.POST.get("revoke") or "").strip()
        # Scoped to the caller's OWN tokens by the filter, not by trusting the
        # id. Somebody else's uuid simply matches nothing.
        killed = MCPToken.objects.filter(
            pk=wanted, user=request.user, revoked_at__isnull=True
        ).update(revoked_at=timezone.now()) if _is_uuid(wanted) else 0
        message = "Revoked. That app can no longer read anything." if killed else ""

    grants = list(
        MCPToken.objects.filter(
            user=request.user, revoked_at__isnull=True, expires_at__gt=timezone.now()
        ).select_related("client")
    )
    return HttpResponse(
        oauth.connections_page(base, request.user, grants, get_token(request), message),
        content_type="text/html; charset=utf-8",
    )


def _is_uuid(value):
    """A bad id must be a no-op, not a 500.

    `MCPToken.pk` is a UUIDField, so filtering it on a non-uuid string raises
    `ValidationError` rather than matching nothing — which would turn a stray
    form value into a server error on a page whose whole job is to be reachable
    when something has gone wrong.
    """
    import uuid as _uuid

    try:
        _uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True
