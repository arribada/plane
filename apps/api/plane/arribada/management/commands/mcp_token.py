# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue, list, revoke and audit MCP credentials.

A management command and deliberately not a settings page. Issuing one of these
is a rare, deliberate act performed by somebody with a shell on the droplet, and
a button in the web app would mean any workspace admin could mint an agent
credential from a browser tab — including through a session somebody left open.
The shell is the second factor.

    # Read-only, no finance, 90 days — the one to start with
    python manage.py mcp_token issue --name "Claude Code" --email you@arribada.org

    # Narrowed to two projects, finance included, 30 days
    python manage.py mcp_token issue --name "Funder report" --email you@arribada.org \\
        --projects TAG,SEA --allow-money --days 30

    python manage.py mcp_token list
    python manage.py mcp_token revoke --prefix arb_mcp_1a2b3c4d
    python manage.py mcp_token calls --limit 20

The secret is printed ONCE, here, and never again. There is no recovery path on
purpose; re-issuing costs one command and a credential a support process can
recover is a credential a support process can leak.
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from plane.db.models import Project, User, Workspace, WorkspaceMember
from plane.app.permissions import ROLE

from plane.arribada.mcp_auth import generate_secret, hash_secret, prefix_of
from django.db.models import Q

from plane.arribada.models import (
    MCPAuthorizationCode,
    MCPCallLog,
    MCPOAuthClient,
    MCPToken,
)


class Command(BaseCommand):
    help = "Issue, list, revoke and audit MCP tokens for the Arribada Plane MCP server."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["issue", "list", "revoke", "calls", "prune"])
        parser.add_argument("--name", help="What this credential is for. Shown in `list` and the audit log.")
        parser.add_argument("--email", help="The user the token acts as. It can never exceed their permissions.")
        parser.add_argument("--workspace", help="Workspace slug. Optional when there is only one.")
        parser.add_argument("--scope", choices=["read", "write"], default="read")
        parser.add_argument(
            "--allow-money",
            action="store_true",
            help="Let this token read budgets, expenses and procurement. Off by default.",
        )
        parser.add_argument(
            "--projects",
            help="Comma-separated project identifiers or ids. Omit for every project the user can see.",
        )
        parser.add_argument("--days", type=int, default=90, help="Lifetime in days. Default 90.")
        parser.add_argument("--prefix", help="Which token to act on, for `revoke` and `calls`.")
        parser.add_argument("--limit", type=int, default=30)
        parser.add_argument("--all", action="store_true", help="`list`: include revoked and expired.")
        parser.add_argument(
            "--older-than",
            type=int,
            default=30,
            help="`prune`: delete spent authorization codes and dead tokens older than N days. Default 30.",
        )
        parser.add_argument("--dry-run", action="store_true", help="`prune`: count, change nothing.")

    # -- dispatch ----------------------------------------------------------

    def handle(self, *args, **options):
        getattr(self, f"_{options['action']}")(options)

    # -- issue -------------------------------------------------------------

    def _issue(self, options):
        if not options.get("name"):
            raise CommandError("--name is required: say what this credential is for.")
        if not options.get("email"):
            raise CommandError("--email is required: a token acts as somebody.")
        if options["days"] < 1 or options["days"] > 365:
            raise CommandError("--days must be between 1 and 365. A credential that outlives the year is one nobody revokes.")

        user = User.objects.filter(email__iexact=options["email"].strip()).first()
        if user is None:
            raise CommandError(f"No account with the email {options['email']}.")
        if not user.is_active:
            raise CommandError(f"{user.email} is not an active account.")

        workspace = self._workspace(options.get("workspace"))

        membership = WorkspaceMember.objects.filter(
            workspace=workspace, member=user, is_active=True
        ).first()
        if membership is None:
            raise CommandError(
                f"{user.email} is not an active member of {workspace.slug}. "
                "A token cannot grant what its owner does not have."
            )

        project_ids = []
        if options.get("projects"):
            project_ids = self._projects(workspace, user, options["projects"])

        secret = generate_secret()
        token = MCPToken.objects.create(
            name=options["name"].strip(),
            token_hash=hash_secret(secret),
            prefix=prefix_of(secret),
            user=user,
            workspace=workspace,
            scope=options["scope"],
            allow_money=bool(options["allow_money"]),
            project_ids=project_ids,
            expires_at=self._expiry(options["days"]),
        )

        w = self.stdout.write
        w("")
        w(self.style.SUCCESS("MCP token issued. This is the only time the secret is shown."))
        w("")
        w(f"  {secret}")
        w("")
        w(f"  name        {token.name}")
        w(f"  acts as     {user.email} ({ROLE(membership.role).name.lower()} of {workspace.slug})")
        w(f"  scope       {token.scope}")
        w(f"  finance     {'READABLE' if token.allow_money else 'refused'}")
        w(f"  projects    {', '.join(str(p) for p in project_ids) if project_ids else 'every project this user can see'}")
        w(f"  expires     {token.expires_at:%Y-%m-%d %H:%M} UTC ({options['days']} days)")
        w(f"  revoke with mcp_token revoke --prefix {token.prefix}")
        w("")
        if token.scope == MCPToken.SCOPE_WRITE:
            w(
                self.style.WARNING(
                    "  This token may write — but only into projects that have turned on external\n"
                    "  edits (ProjectSchedule.external_edits). No project has that on by default."
                )
            )
            w("")
        w("  Put it in an environment variable, not in a config file:")
        w("")
        w("    setx PLANE_MCP_TOKEN \"<the secret above>\"     (Windows)")
        w("    export PLANE_MCP_TOKEN='<the secret above>'    (macOS / Linux)")
        w("")

    @staticmethod
    def _expiry(days):
        from datetime import timedelta

        return timezone.now() + timedelta(days=days)

    def _workspace(self, slug):
        if slug:
            workspace = Workspace.objects.filter(slug=slug).first()
            if workspace is None:
                raise CommandError(f"No workspace with the slug '{slug}'.")
            return workspace
        options = list(Workspace.objects.all()[:5])
        if len(options) == 1:
            return options[0]
        raise CommandError(
            "--workspace is required. Available: " + ", ".join(w.slug for w in options)
        )

    def _projects(self, workspace, user, raw):
        """Resolve the allow-list, refusing anything the USER cannot already see.

        A token is an attenuation. Accepting a project id its owner has no access
        to would write a grant into the database that reads as wider than it is —
        the endpoints would still refuse it, and the row would still say the agent
        has that project. A stored permission that lies is worth failing over.
        """
        wanted = [p.strip() for p in raw.split(",") if p.strip()]
        visible = Project.objects.filter(
            workspace=workspace,
            project_projectmember__member=user,
            project_projectmember__is_active=True,
        ).distinct()

        resolved, missing = [], []
        for item in wanted:
            match = visible.filter(identifier__iexact=item).first()
            if match is None:
                match = visible.filter(name__iexact=item).first()
            if match is None:
                try:
                    match = visible.filter(id=item).first()
                except (ValueError, TypeError):
                    match = None
            if match is None:
                missing.append(item)
            else:
                resolved.append(str(match.id))
        if missing:
            raise CommandError(
                f"{user.email} cannot see: {', '.join(missing)}. "
                "Available: " + ", ".join(f"{p.identifier} ({p.name})" for p in visible.order_by("identifier"))
            )
        return resolved

    # -- list --------------------------------------------------------------

    def _list(self, options):
        rows = MCPToken.objects.select_related("user", "workspace").all()
        now = timezone.now()
        shown = 0
        w = self.stdout.write
        w("")
        # `HOW` is not decoration: an OAuth grant and a token somebody pasted
        # into a config are revoked for different reasons and by different
        # people, and before this column they looked identical in this list.
        w(f"{'PREFIX':<18} {'HOW':<7} {'NAME':<22} {'ACTS AS':<26} {'SCOPE':<6} {'$':<3} {'STATE':<8} EXPIRES")
        for token in rows:
            if token.revoked_at is not None:
                state = "revoked"
            elif token.expires_at <= now:
                state = "expired"
            else:
                state = "live"
            if state != "live" and not options["all"]:
                continue
            shown += 1
            w(
                f"{token.prefix:<18} {token.kind:<7} {token.name[:21]:<22} "
                f"{token.user.email[:25]:<26} "
                f"{token.scope:<6} {'yes' if token.allow_money else '-':<3} {state:<8} "
                f"{token.expires_at:%Y-%m-%d}"
                + ("" if not token.project_ids else f"  [{len(token.project_ids)} projects]")
            )
        if shown == 0:
            w("  (none)" + ("" if options["all"] else " — pass --all to include revoked and expired"))
        w("")

    # -- revoke ------------------------------------------------------------

    def _revoke(self, options):
        if not options.get("prefix"):
            raise CommandError("--prefix is required. Run `mcp_token list` to see them.")
        token = MCPToken.objects.filter(prefix__startswith=options["prefix"].strip()).first()
        if token is None:
            raise CommandError(f"No token whose prefix starts with '{options['prefix']}'.")
        if token.revoked_at is not None:
            self.stdout.write(f"Already revoked on {token.revoked_at:%Y-%m-%d %H:%M} UTC.")
            return
        token.revoked_at = timezone.now()
        token.save(update_fields=["revoked_at"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Revoked '{token.name}' ({token.prefix}). It stops working on the next call — "
                "there is no cache in front of this."
            )
        )
        self.stdout.write(
            f"Its {token.calls.count()} logged calls are kept; the row stays so the log still "
            "says who did what."
        )

    # -- calls -------------------------------------------------------------

    def _calls(self, options):
        rows = MCPCallLog.objects.select_related("user").all()
        if options.get("prefix"):
            rows = rows.filter(token_prefix__startswith=options["prefix"].strip())
        w = self.stdout.write
        w("")
        w(f"{'WHEN':<18} {'PREFIX':<18} {'TOOL':<22} {'MS':<6} RESULT")
        for row in rows[: options["limit"]]:
            w(
                f"{row.created_at:%Y-%m-%d %H:%M} {row.token_prefix:<18} {row.tool:<22} "
                f"{row.duration_ms:<6} " + ("ok" if row.ok else f"FAILED: {row.error[:70]}")
            )
        w("")

    # -- prune -------------------------------------------------------------

    def _prune(self, options):
        """Delete what is finished: spent or expired authorization codes, and
        tokens that have been revoked or have expired.

        A COMMAND AND NOT A BEAT TASK, deliberately. Adding one to the schedule
        means a new entry in `apps.py`, a matching one in the beat config and a
        line in `test_beat_schedule.py` — three coupled places to keep right for
        a table that grows by one short-lived row per authorization. An OAuth
        access token lives 24 hours and a code lives five minutes; the volume
        here is a handful of rows a week, not a problem waiting to happen. Run
        it by hand when the table offends you, and turn it into a task the day
        the numbers say so.

        Codes are deleted only once they are USED OR EXPIRED, so a prune racing
        with a live authorization cannot take a code somebody is about to redeem.
        """
        from datetime import timedelta

        cutoff = timezone.now() - timedelta(days=max(options["older_than"], 1))
        now = timezone.now()

        codes = MCPAuthorizationCode.objects.filter(created_at__lt=cutoff).filter(
            Q(consumed_at__isnull=False) | Q(expires_at__lt=now)
        )
        tokens = MCPToken.objects.filter(created_at__lt=cutoff).filter(
            Q(revoked_at__isnull=False) | Q(expires_at__lt=now)
        )
        # Clients with nothing left pointing at them. A connector re-registers
        # itself on the next authorization, so an unused row is just litter.
        clients = MCPOAuthClient.objects.filter(created_at__lt=cutoff, tokens__isnull=True, codes__isnull=True)

        w = self.stdout.write
        if options["dry_run"]:
            w(f"would delete {codes.count()} spent codes, {tokens.count()} dead tokens, "
              f"{clients.count()} unused clients (older than {options['older_than']} days)")
            return

        c = codes.count()
        t = tokens.count()
        n = clients.count()
        codes.delete()
        tokens.delete()
        clients.delete()
        w(self.style.SUCCESS(
            f"deleted {c} spent codes, {t} dead tokens, {n} unused clients "
            f"(older than {options['older_than']} days)"
        ))
        w("The MCP call log is NOT touched: it keeps `token_prefix` precisely so it outlives "
          "the token, and it is the only record of what an agent did.")
