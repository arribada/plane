# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The credential an AI agent uses to read this fork, and the record of what it did.

A module of its own rather than more lines on `models.py`, which is already past
1,600, and imported by name at the bottom of it so Django's app registry and the
migration autodetector see these two exactly as if they were declared there. The
import is not optional and it is not cosmetic: a model in a module nothing
imports is a model with no table and no migration, and it fails silently.

WHY NOT `db.APIToken`. Upstream's API key is the obvious thing to hand an agent
and it is the wrong thing, on four counts, every one of which matters more for a
program than for a person:

  1. It is stored in PLAINTEXT (`api_tokens.token`). This fork takes a database
     dump before every migration, so that is a file full of live credentials
     sitting in `/opt/backups/archive`.
  2. It carries the FULL authority of the user it belongs to, over the whole
     workspace. There are two accounts on this instance and one of them is the
     workspace admin, so in practice "an API key" means "everything".
  3. It cannot be narrowed to a project and it cannot be told to stay out of the
     money. The Finance module's figures reach funders; `MONEY_ROLES` exists
     precisely because not every reader of a project is a reader of its budget.
  4. It never expires unless somebody remembers to set `expired_at`, and nothing
     anywhere records what it did.

THE RULE THIS MODEL EXISTS TO MAKE TRUE: **a token can never do anything its
owner could not do.** It is an ATTENUATION, never a grant. Every tool calls the
fork's real endpoints, which ask `allow_permission` about `token.user` — so the
fields here can only subtract from an answer somebody else already gave. That
ordering is the entire security argument, and `test_mcp.py` asserts it in both
directions, because a check that only proves refusal passes on an endpoint that
refuses everyone.
"""

import uuid
from datetime import timedelta

from django.db import models
from django.utils import timezone


def mcp_default_expiry():
    """Ninety days from now.

    A module-level function because a field default has to be serialisable into
    a migration, and a lambda is not.
    """
    return timezone.now() + timedelta(days=90)


class MCPToken(models.Model):
    """One bearer credential, for one agent, on one workspace, as one user.

    `token_hash` is SHA-256 of the secret, and the secret itself is shown exactly
    once — by `manage.py mcp_token issue`, on stdout, at creation. There is
    deliberately no way to read it back afterwards: a credential a support
    process can recover is a credential a support process can leak, and
    re-issuing one costs a single command.

    `prefix` is the first 16 characters of the secret, kept in clear so a human
    can tell two tokens apart here and in the audit log. Sixteen characters of a
    73-character secret authenticates nothing.
    """

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)

    name = models.CharField(max_length=255)

    # `unique` already builds the index this is looked up by. Spelling
    # `db_index=True` beside it would ask Postgres for a second one over the same
    # column, which costs an extra write per token and buys nothing.
    token_hash = models.CharField(max_length=64, unique=True)
    prefix = models.CharField(max_length=24)

    # The identity every tool call runs as. CASCADE is the only correct answer: a
    # token whose owner is gone is a token with no permissions left to attenuate.
    user = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="mcp_tokens")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="mcp_tokens")

    # READ is the default here and in the CLI. A write grant is still not
    # sufficient on its own: the project must ALSO have opted in through
    # `ProjectSchedule.external_edits` — the same switch the wiki sync answers
    # to. Two independent consents, because an agent writing into a project
    # nobody asked to have written into is the failure worth a second query.
    SCOPE_READ = "read"
    SCOPE_WRITE = "write"
    SCOPES = ((SCOPE_READ, "Read only"), (SCOPE_WRITE, "Read and write"))
    scope = models.CharField(max_length=8, choices=SCOPES, default=SCOPE_READ)

    # Finance — budgets, expenses, rates, procurement — is off unless this is
    # explicitly on, INDEPENDENTLY of scope. An agent that can read every figure
    # a funder report is built from has not been given a small grant, and "read
    # only" is the phrase that makes people believe it has.
    allow_money = models.BooleanField(default=False)

    # Empty list = every project the user can already see. A non-empty list is an
    # allow-list, INTERSECTED with what the user may see and never added to it.
    # JSON rather than a M2M because it is read on every call and never joined.
    project_ids = models.JSONField(default=list, blank=True)

    # Not nullable, and there is no "never" value. An agent credential that lives
    # forever is the one nobody remembers to revoke.
    expires_at = models.DateTimeField(default=mcp_default_expiry)

    revoked_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    # --- OAuth ------------------------------------------------------------
    #
    # An OAuth access token IS one of these rows. That is the whole reason the
    # OAuth work added two models and not three: `MCPTokenAuthentication`, the
    # three gates and the audit log all key off `MCPToken`, so a second
    # credential type would have meant a second copy of every one of them —
    # and a second copy of a permission is a permission that stops agreeing
    # with itself. The connector's token and a `mcp_token issue` token differ
    # only by `kind` and by who is allowed to mint them.
    KIND_CLI = "cli"
    KIND_OAUTH = "oauth"
    KINDS = ((KIND_CLI, "Issued from a shell"), (KIND_OAUTH, "Issued by the OAuth flow"))
    kind = models.CharField(max_length=8, choices=KINDS, default=KIND_CLI)

    client = models.ForeignKey(
        "arribada.MCPOAuthClient",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="tokens",
    )

    # SHA-256 of the refresh token, same as `token_hash` and for the same
    # reason. Empty for a CLI token, which has no refresh: a credential a human
    # pasted into a config has nothing to rotate against.
    #
    # The refresh secret carries the prefix `arb_mcpr_`, which deliberately does
    # NOT start with `arb_mcp_` — so a refresh token presented as a bearer is
    # refused by the prefix check before any query runs.
    refresh_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)
    refresh_expires_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "db.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mcp_tokens_created",
    )

    class Meta:
        db_table = "arribada_mcp_token"
        ordering = ("-created_at",)
        verbose_name = "MCP token"
        verbose_name_plural = "MCP tokens"

    def __str__(self):
        return f"{self.name} ({self.prefix}…) {self.scope}"

    @property
    def is_live(self):
        return self.revoked_at is None and self.expires_at > timezone.now()

    def allows_project(self, project_id):
        """Whether this token's allow-list admits `project_id`.

        Says nothing about whether the USER may see it. That question belongs to
        `allow_permission`, is asked afterwards, and is the one that can refuse.
        This can only subtract.
        """
        if not self.project_ids:
            return True
        return str(project_id) in {str(p) for p in self.project_ids}


class MCPCallLog(models.Model):
    """What an agent actually did, kept whether or not the token survives it.

    `token_prefix` is stored beside the FK rather than only the FK, because the
    most interesting moment to read this table is right after somebody deleted a
    token in a hurry — and a CASCADE would have taken the evidence with it.

    Arguments are truncated and results are NOT stored. A tool result can be a
    whole project's budget, and a log that mirrors the data it exists to guard is
    simply a second copy of the thing to protect.
    """

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)

    token = models.ForeignKey(
        MCPToken, on_delete=models.SET_NULL, null=True, blank=True, related_name="calls"
    )
    token_prefix = models.CharField(max_length=24, db_index=True)
    user = models.ForeignKey(
        "db.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="mcp_calls"
    )

    tool = models.CharField(max_length=64, db_index=True)
    arguments = models.TextField(blank=True, default="")
    ok = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")
    duration_ms = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "arribada_mcp_call_log"
        ordering = ("-created_at",)
        verbose_name = "MCP call"
        verbose_name_plural = "MCP calls"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.tool} {'ok' if self.ok else 'FAILED'}"


class MCPOAuthClient(models.Model):
    """A client registered through RFC 7591 Dynamic Client Registration.

    REGISTRATION IS OPEN, and that is the protocol rather than an oversight:
    the MCP spec expects a connector to register itself before a human has done
    anything, so there is no credential to demand at that point. What keeps it
    safe is that a registration grants NOTHING. It mints a `client_id` and a
    `redirect_uri` allow-list and no more; every token still requires a signed-in
    Plane user to read a consent screen and press a button. The worst an
    unattended registration achieves is a row in this table, which is why the
    endpoint is rate-limited and this model records where it came from.

    Public clients only — `token_endpoint_auth_method: "none"` — because a
    desktop or browser client cannot hold a secret. PKCE S256 is what stands in
    for one, and the token endpoint refuses a code without it.
    """

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)

    client_id = models.CharField(max_length=64, unique=True)
    client_name = models.CharField(max_length=255, blank=True, default="")

    # Exact-match allow-list. A redirect_uri that is not in here is refused
    # BEFORE anything is redirected anywhere — see `validate_client_and_redirect`
    # in mcp_oauth.py for why that ordering is the whole security of this step.
    redirect_uris = models.JSONField(default=list)

    # Not identity, and not trusted for anything — it is here so that a table
    # full of junk registrations can be read and cleaned up by a human.
    registered_ip = models.GenericIPAddressField(null=True, blank=True)
    registered_user_agent = models.CharField(max_length=512, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "arribada_mcp_oauth_client"
        ordering = ("-created_at",)
        verbose_name = "MCP OAuth client"
        verbose_name_plural = "MCP OAuth clients"

    def __str__(self):
        return f"{self.client_name or '(unnamed)'} [{self.client_id}]"

    def allows_redirect(self, uri):
        return uri in (self.redirect_uris or [])


class MCPAuthorizationCode(models.Model):
    """One authorization code, hashed, single-use, five minutes.

    Single use is enforced by a CONDITIONAL UPDATE rather than a read followed
    by a write — `filter(consumed_at__isnull=True).update(...)` and a check on
    the row count. Two token requests racing with the same code then have
    exactly one winner, decided by the database. The read-then-write version
    passes every test written against it and loses the race in production,
    which is the class of bug this fork already has a fencing token for.

    The grant the user actually consented to is stored HERE, not re-read from
    the request at the token endpoint: the consent screen is where a human made
    a decision, and anything the client sends afterwards is just a claim.
    """

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)

    code_hash = models.CharField(max_length=64, unique=True)
    client = models.ForeignKey(MCPOAuthClient, on_delete=models.CASCADE, related_name="codes")
    user = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="mcp_oauth_codes")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="mcp_oauth_codes")

    redirect_uri = models.TextField()
    code_challenge = models.CharField(max_length=128)
    code_challenge_method = models.CharField(max_length=8, default="S256")

    # RFC 8707, RECORDED AND NOT ENFORCED, said plainly because the previous
    # version of this comment claimed it was "echoed back and checked" and no
    # such check exists. A comment that asserts a control nobody implemented is
    # worse than no comment: the next person reads it and stops looking.
    #
    # There is nothing to enforce it against today. This authorization server
    # guards exactly one resource — the MCP endpoint — so a code cannot be
    # redeemed against a different one; there is no different one. The column
    # exists so that the day a second resource appears, the value the client
    # asked for is already on the row and the check is a comparison rather than
    # a migration.
    resource = models.TextField(blank=True, default="")

    # What the human ticked. Mirrors the two grant fields on MCPToken.
    granted_scope = models.CharField(max_length=8, default=MCPToken.SCOPE_READ)
    granted_money = models.BooleanField(default=False)

    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "arribada_mcp_authorization_code"
        ordering = ("-created_at",)
        verbose_name = "MCP authorization code"
        verbose_name_plural = "MCP authorization codes"

    def __str__(self):
        return f"code for {self.user_id} via {self.client_id} ({'used' if self.consumed_at else 'live'})"
