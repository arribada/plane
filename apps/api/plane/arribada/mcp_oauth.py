# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth 2.1 for the MCP server: metadata, PKCE, token issuance, consent screen.

The endpoints live in `mcp_oauth_views.py`; this module is the helpers they
share. Modelled on the wiki's (Colanode's) working implementation, which is the
only proof anybody here has of what the Claude connector actually requires —
the spec says a great deal and the client's behaviour is the thing that has to
be satisfied.

TWO DELIBERATE DEPARTURES FROM THE WIKI'S VERSION, both because Plane is a
different shape:

  1. **The user is not asked for a password.** Colanode's consent screen takes
     an email and a password because Colanode has no browser session at that
     point. Plane does: `/oauth/authorize` is an ordinary Django view behind
     the session middleware, so an already-signed-in user simply lands on the
     consent screen, and one who is not is sent to Plane's own sign-in with
     `next_path` back here. That is strictly better — this code never sees a
     password, and Google/GitLab SSO keeps working, which it could not if the
     form demanded one.

  2. **Scopes are the grant this fork already has.** Colanode issues a single
     `wiki` scope. Here the consent screen offers the three things an MCPToken
     can carry — read, write, finance — and writes them onto the token it
     mints. So an OAuth token is attenuated by the same three gates as a CLI
     token, by the same code, and a user can hand a connector read-only access
     to their own projects without thinking about it.

WHAT THE ACCESS TOKEN IS: a row in `arribada_mcp_token`, exactly like the ones
`manage.py mcp_token issue` writes, with `kind="oauth"` and a client attached.
`MCPTokenAuthentication` needed no change at all to accept it, and neither did
the three gates or the audit log. That was the point.
"""

import base64
import hashlib
import secrets
from datetime import timedelta
from urllib.parse import quote, urlencode, urlparse

from django.utils import timezone
from django.utils.html import escape

from .mcp_auth import TOKEN_PREFIX, hash_secret, prefix_of
from .models import MCPAuthorizationCode, MCPOAuthClient, MCPToken

# Paths. Clients probe these at the DOMAIN ROOT, which is why `oauth_urls.py`
# is mounted on the root URLconf rather than under `/api/arribada/`, and why
# the Caddy in front of this had to learn about them — see ARRIBADA.md.
AUTHORIZE_PATH = "/oauth/authorize"
TOKEN_PATH = "/oauth/token"
REGISTER_PATH = "/oauth/register"
MCP_RESOURCE_PATH = "/api/arribada/mcp/"
PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource"
AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server"

AUTH_CODE_TTL = timedelta(minutes=5)
ACCESS_TOKEN_TTL = timedelta(hours=24)
REFRESH_TOKEN_TTL = timedelta(days=180)

# The refresh secret's prefix. It does NOT start with `arb_mcp_`, so a refresh
# token sent as a bearer is refused by the prefix check in `mcp_auth.py` before
# a query runs. A single underscore is doing real work here; do not "tidy" it.
REFRESH_PREFIX = "arb_mcpr_"

SCOPE_READ = "plane:read"
SCOPE_WRITE = "plane:write"
SCOPE_FINANCE = "plane:finance"
SUPPORTED_SCOPES = (SCOPE_READ, SCOPE_WRITE, SCOPE_FINANCE)


def base_url(request):
    """The public origin, as the client sees it.

    Built from the forwarded headers rather than from `WEB_URL`, because the
    issuer a client validates is the host it actually typed. Nginx sets
    `X-Forwarded-Proto: https` and passes `Host` through; `request.get_host()`
    honours `USE_X_FORWARDED_HOST` and the ALLOWED_HOSTS check, so a spoofed
    Host header cannot move the issuer to somebody else's domain.
    """
    scheme = request.META.get("HTTP_X_FORWARDED_PROTO") or ("https" if request.is_secure() else "http")
    return f"{scheme}://{request.get_host()}"


# ---------------------------------------------------------------------------
# Discovery metadata
# ---------------------------------------------------------------------------


def protected_resource_metadata(base):
    """RFC 9728. Says which authorization server guards this resource."""
    return {
        "resource": f"{base}{MCP_RESOURCE_PATH}",
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
        "scopes_supported": list(SUPPORTED_SCOPES),
        "resource_name": "Arribada Plane MCP",
        "resource_documentation": f"{base}{MCP_RESOURCE_PATH}",
    }


def authorization_server_metadata(base):
    """RFC 8414.

    `token_endpoint_auth_methods_supported: ["none"]` is not laxity — every
    client here is public (a desktop app, an editor, a browser), none can keep
    a secret, and pretending otherwise would put a shared password in a config
    file on every machine. PKCE S256 is the control that replaces it, and
    `code_challenge_methods_supported` advertises only S256: `plain` is in the
    spec and is worth nothing.
    """
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}{AUTHORIZE_PATH}",
        "token_endpoint": f"{base}{TOKEN_PATH}",
        "registration_endpoint": f"{base}{REGISTER_PATH}",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": list(SUPPORTED_SCOPES),
        "service_documentation": base,
    }


def www_authenticate(base):
    """The header a 401 from the MCP endpoint carries.

    `resource_metadata=` is the part that matters and the part that was missing
    before OAuth existed here: without it a client has a 401 and no idea where
    to go, so it guesses — which is exactly what produced "impossible to
    register with the login service", a message about the wrong thing.
    """
    return (
        f'Bearer realm="arribada-mcp", '
        f'resource_metadata="{base}{PROTECTED_RESOURCE_METADATA_PATH}"'
    )


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------


def verify_pkce_s256(verifier, challenge):
    """BASE64URL(SHA256(verifier)) == challenge, in constant time.

    `compare_digest` here and not `==`, unlike the token lookup which compares
    nothing in Python: this one really is a secret-versus-secret comparison in
    application code, so the timing argument applies.
    """
    if not verifier or not challenge:
        return False
    digest = hashlib.sha256(verifier.encode("ascii", "ignore")).digest()
    expected = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return secrets.compare_digest(expected, challenge)


# ---------------------------------------------------------------------------
# Clients and redirect URIs
# ---------------------------------------------------------------------------


def redirect_uri_is_acceptable(uri):
    """Whether a client may REGISTER this redirect URI.

    Registration is open, so this is the only place the shape of a callback is
    judged. Three forms are allowed and the reasoning for each is the threat,
    not the convenience:

      - `https://…` — a real site. Fine, and the exact string is stored, so
        registering `https://evil.test/cb` only ever sends codes to a client
        that already knew it was `evil.test`; it cannot intercept anybody
        else's, because the code is bound to the client AND to the URI.
      - `http://localhost` / `http://127.0.0.1` with any port — how every
        desktop MCP client receives its callback. Plain HTTP to the loopback
        does not leave the machine.
      - a custom scheme like `claude://…` — how a native app is woken up.

    Refused: plain `http://` to anything that is not loopback, which is a
    callback that crosses a network in clear.
    """
    if not uri or len(uri) > 2000:
        return False
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False
    if not parsed.scheme:
        return False
    if parsed.scheme == "https":
        return bool(parsed.netloc)
    if parsed.scheme == "http":
        return parsed.hostname in ("localhost", "127.0.0.1", "::1")
    # A custom scheme has no authority to speak of; requiring one would refuse
    # the `com.example.app:/callback` form the RFC itself gives as an example.
    return ":" in uri and not parsed.scheme.startswith("javascript")


def register_client(name, redirect_uris, ip=None, user_agent=""):
    return MCPOAuthClient.objects.create(
        client_id=secrets.token_urlsafe(24),
        client_name=(name or "")[:255],
        redirect_uris=list(redirect_uris),
        registered_ip=ip,
        registered_user_agent=(user_agent or "")[:512],
    )


# ---------------------------------------------------------------------------
# Codes and tokens
# ---------------------------------------------------------------------------


def issue_code(client, user, workspace, redirect_uri, code_challenge, resource, scope, money):
    """Mint an authorization code and return the plaintext exactly once."""
    code = secrets.token_urlsafe(32)
    MCPAuthorizationCode.objects.create(
        code_hash=hash_secret(code),
        client=client,
        user=user,
        workspace=workspace,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        code_challenge_method="S256",
        resource=resource or "",
        granted_scope=scope,
        granted_money=bool(money),
        expires_at=timezone.now() + AUTH_CODE_TTL,
    )
    return code


def consume_code(code):
    """Claim an authorization code, atomically, or return None.

    The conditional UPDATE is the lock. Reading the row, checking
    `consumed_at`, then writing it back would be correct in every test and
    wrong under two token requests arriving together — and a replayed code is
    a second access token for whoever replayed it.
    """
    row = MCPAuthorizationCode.objects.select_related("client", "user", "workspace").filter(
        code_hash=hash_secret(code)
    ).first()
    if row is None:
        return None
    claimed = MCPAuthorizationCode.objects.filter(pk=row.pk, consumed_at__isnull=True).update(
        consumed_at=timezone.now()
    )
    if claimed != 1:
        return None
    if row.expires_at <= timezone.now():
        return None
    return row


def issue_tokens(user, workspace, client, scope, money, name=None):
    """Mint an access + refresh pair as ONE MCPToken row.

    Returns `(access, refresh, token)`. Both secrets are returned in clear here
    and nowhere else; the row keeps only their hashes.
    """
    access = TOKEN_PREFIX + secrets.token_hex(32)
    refresh = REFRESH_PREFIX + secrets.token_hex(32)
    now = timezone.now()
    token = MCPToken.objects.create(
        name=(name or f"OAuth: {client.client_name or client.client_id}")[:255],
        token_hash=hash_secret(access),
        prefix=prefix_of(access),
        user=user,
        workspace=workspace,
        scope=scope,
        allow_money=bool(money),
        project_ids=[],
        expires_at=now + ACCESS_TOKEN_TTL,
        kind=MCPToken.KIND_OAUTH,
        client=client,
        refresh_hash=hash_secret(refresh),
        refresh_expires_at=now + REFRESH_TOKEN_TTL,
    )
    return access, refresh, token


def rotate(refresh, client):
    """Exchange a refresh token for a new pair, revoking the old row.

    ROTATION ON EVERY USE, so a stolen refresh token is good for one exchange
    and then collides with the legitimate client's next one. Returns
    `(access, refresh, token)` or None.
    """
    old = MCPToken.objects.select_related("user", "workspace", "client").filter(
        refresh_hash=hash_secret(refresh), kind=MCPToken.KIND_OAUTH
    ).first()
    if old is None or old.revoked_at is not None:
        return None
    if old.refresh_expires_at is None or old.refresh_expires_at <= timezone.now():
        return None
    # The client presenting the refresh token must be the one it was issued to.
    # Without this, any registered client — and registration is open — could
    # redeem a refresh token it happened to obtain.
    if old.client_id != client.id:
        return None

    claimed = MCPToken.objects.filter(pk=old.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )
    if claimed != 1:
        return None
    return issue_tokens(old.user, old.workspace, client, old.scope, old.allow_money, name=old.name)


# ---------------------------------------------------------------------------
# The consent screen
# ---------------------------------------------------------------------------

_HIDDEN = (
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
)


def _hidden_fields(params):
    return "\n      ".join(
        f'<input type="hidden" name="{escape(k)}" value="{escape(str(params[k]))}" />'
        for k in _HIDDEN
        if params.get(k) not in (None, "")
    )


def sign_in_url(base, request):
    """Where to send somebody who is not signed in.

    Plane's own sign-in page, with `next_path` back to this authorize request
    including its query string — so after logging in (password, Google, or the
    GitLab-compatible SSO) the browser lands back on the consent screen with
    every OAuth parameter intact. Losing the query string here is how this kind
    of flow ends in a blank page the user cannot explain.
    """
    target = request.get_full_path()
    return f"{base}/?{urlencode({'next_path': target})}"


def consent_page(base, client, user, params, requested):
    """The one screen a human sees. Plain server-rendered HTML, no assets.

    Deliberately not a React page in the Plane app: this must render before any
    token exists, must work with JavaScript disabled, and must not be able to
    fetch anything. What it says matters more than how it looks — the person
    reading it is granting a program access to their own projects and, if they
    tick it, to figures that reach funders.
    """
    name = escape(client.client_name or client.client_id)
    who = escape(user.display_name or user.first_name or user.email)
    email = escape(user.email)

    def row(value, label, detail, checked, disabled=False):
        return f"""
        <label class="opt{' fixed' if disabled else ''}">
          <input type="checkbox" name="grant" value="{value}" {'checked' if checked else ''} {'disabled' if disabled else ''} />
          <span><strong>{label}</strong><br /><small>{detail}</small></span>
        </label>"""

    options = row(
        "read",
        "Read your projects",
        "Plans, work items, milestones, people and workload — everything you can already see.",
        True,
        disabled=True,
    )
    options += row(
        "finance",
        "Read finance",
        "Budgets, expenses and purchase requests. These are the figures funder reports are built from.",
        SCOPE_FINANCE in requested,
    )
    options += row(
        "write",
        "Create and update work items",
        "Never dates, parents or estimates — those stay the project lead's. Only takes effect on projects that have turned on external edits.",
        SCOPE_WRITE in requested,
    )

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorise {name} — Arribada Plane</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         display: grid; place-items: center; min-height: 100vh; background: #f6f7f9; color: #14181f; }}
  @media (prefers-color-scheme: dark) {{ body {{ background: #0f1216; color: #e6e9ee; }} }}
  .card {{ background: #fff; border-radius: 12px; padding: 28px; max-width: 460px; width: calc(100% - 32px);
           box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); }}
  @media (prefers-color-scheme: dark) {{ .card {{ background: #171b21; box-shadow: none; border: 1px solid #262c35; }} }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  .sub {{ color: #6b7280; margin: 0 0 20px; font-size: 14px; }}
  .opt {{ display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border: 1px solid #e3e6ea;
          border-radius: 8px; margin-bottom: 8px; cursor: pointer; }}
  @media (prefers-color-scheme: dark) {{ .opt {{ border-color: #2b323c; }} }}
  .opt.fixed {{ opacity: .7; cursor: default; }}
  .opt input {{ margin-top: 3px; }}
  small {{ color: #6b7280; }}
  .actions {{ display: flex; gap: 10px; margin-top: 20px; }}
  button {{ flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid transparent; font: inherit;
            font-weight: 600; cursor: pointer; }}
  .primary {{ background: #3f76ff; color: #fff; }}
  .ghost {{ background: transparent; border-color: #d3d8de; color: inherit; }}
  .who {{ font-size: 13px; color: #6b7280; margin-top: 18px; border-top: 1px solid #e9ecef; padding-top: 12px; }}
  @media (prefers-color-scheme: dark) {{ .who {{ border-color: #262c35; }} }}
</style></head>
<body>
  <form class="card" method="post" action="{AUTHORIZE_PATH}">
    <h1>{name} wants to read your Arribada Plane</h1>
    <p class="sub">It will act as you, and can never do anything you could not do yourself.</p>
    {options}
    <div class="actions">
      <button type="submit" name="decision" value="deny" class="ghost">Cancel</button>
      <button type="submit" name="decision" value="allow" class="primary">Authorise</button>
    </div>
    <p class="who">Signed in as {who} &lt;{email}&gt;. Access lasts 24 hours and renews itself
    until you revoke it. You can revoke it at any time from the server.</p>
    {_hidden_fields(params)}
  </form>
</body></html>"""


def error_redirect(redirect_uri, error, description, state=None):
    """An OAuth error delivered the way the spec wants it — back to the client.

    Only ever called with a redirect_uri that has already been matched against
    the registered allow-list. Reporting an error to an unvalidated URI is how
    an open redirect is built.
    """
    params = {"error": error, "error_description": description}
    if state:
        params["state"] = state
    joiner = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{joiner}{urlencode(params, quote_via=quote)}"


def success_redirect(redirect_uri, code, state=None):
    params = {"code": code}
    if state:
        params["state"] = state
    joiner = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{joiner}{urlencode(params, quote_via=quote)}"
