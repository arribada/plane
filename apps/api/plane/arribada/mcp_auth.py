# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Turning an `Authorization: Bearer` header into a user and a grant.

The secret never reaches the database. It is hashed on the way in and looked up
by hash, so the unique index does the comparison and there is nothing to compare
in Python — which is also why there is no `compare_digest` here and no timing
argument to make: an attacker who does not know the secret cannot produce the
hash that finds the row.

SHA-256 without a work factor is deliberate, and it is the opposite of the right
answer for a password. These secrets are 256 bits of `secrets.token_hex` — there
is no dictionary to run against them and no user who picked one — while the hash
is computed on EVERY tool call, so bcrypt here would buy nothing and cost a
hundred milliseconds a request. A password is low-entropy and needs the work
factor; this is high-entropy and needs the index.
"""

import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

# The literal that says "this is an MCP credential and not upstream's API key".
# Handed out in the open, matched before any query: a header that does not start
# with it is refused without touching the database, so a scanner spraying bearer
# tokens at this endpoint costs one string comparison each.
TOKEN_PREFIX = "arb_mcp_"

# How stale `last_used_at` may get before we spend a write on it. Every call
# would mean an UPDATE per tool call for a column nobody reads in real time; a
# minute's resolution answers the only question it is ever asked, which is "is
# this credential still in use, or can I revoke it".
LAST_USED_RESOLUTION = timedelta(seconds=60)


def generate_secret():
    """A fresh secret. 256 bits, hex, behind the prefix."""
    return TOKEN_PREFIX + secrets.token_hex(32)


def hash_secret(secret):
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def prefix_of(secret):
    """The clear-text fragment stored beside the hash so a human can tell two
    tokens apart. Sixteen characters of a seventy-two-character secret, eight of
    which are the fixed prefix, authenticates nothing."""
    return secret[:16]


class MCPTokenAuthentication(authentication.BaseAuthentication):
    """`Authorization: Bearer arb_mcp_…` -> (user, MCPToken).

    Returning `None` rather than raising, when the header is absent or is not
    ours, is DRF's contract for "not my business" and it matters here: it lets
    the 401 carry a `WWW-Authenticate` header, which is what tells an MCP client
    it needs a credential rather than that it has been forbidden.
    """

    keyword = "Bearer"
    www_authenticate_realm = "arribada-mcp"

    def authenticate(self, request):
        header = request.headers.get("Authorization") or ""
        parts = header.split()
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower():
            return None
        secret = parts[1]
        if not secret.startswith(TOKEN_PREFIX):
            return None

        from .models import MCPToken

        token = MCPToken.objects.select_related("user", "workspace").filter(
            token_hash=hash_secret(secret)
        ).first()
        if token is None:
            raise AuthenticationFailed("Unknown MCP token.")
        if token.revoked_at is not None:
            raise AuthenticationFailed("This MCP token has been revoked.")
        if token.expires_at <= timezone.now():
            raise AuthenticationFailed(
                f"This MCP token expired on {token.expires_at:%Y-%m-%d}. Issue a new one."
            )
        if not token.user.is_active:
            # The account behind the grant is gone or suspended. Refusing here
            # rather than letting the endpoints refuse means one message instead
            # of every tool failing separately for a reason none of them name.
            raise AuthenticationFailed("The account this MCP token belongs to is not active.")

        now = timezone.now()
        if token.last_used_at is None or now - token.last_used_at > LAST_USED_RESOLUTION:
            # `update()` and not `save()`: `save()` would write every column,
            # including ones a concurrent revocation may just have changed.
            type(token).objects.filter(pk=token.pk).update(last_used_at=now)
            token.last_used_at = now

        return (token.user, token)

    def authenticate_header(self, request):
        """The `WWW-Authenticate` on every 401 from the MCP endpoint.

        `resource_metadata=` is the load-bearing part and it was missing until
        OAuth existed here. Without it a client has a 401 and nowhere to go, so
        it falls back to guessing — which is how an empty bearer header turned
        into "impossible to register with the login service", a message about a
        component that was not the problem. With it, the client fetches the
        document, finds the authorization server, and either logs the user in
        or says something true.
        """
        from .mcp_oauth import www_authenticate

        return www_authenticate(_base_url(request))


def _base_url(request):
    """Public origin of this server.

    A local copy rather than importing `mcp_oauth.base_url` at module level:
    `mcp_oauth` imports from this module, and a top-level import back would be
    a cycle. The function-level import above is enough for the header; this
    keeps the cheap part cheap.
    """
    scheme = request.META.get("HTTP_X_FORWARDED_PROTO") or ("https" if request.is_secure() else "http")
    return f"{scheme}://{request.get_host()}"
