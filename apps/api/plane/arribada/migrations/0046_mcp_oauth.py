# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth 2.1 for the MCP server: two new tables and four columns.

**No `RunPython`.** Two `CreateModel`s and four `AddField`s, every one of them
nullable or defaulted, so the migration is safe to apply with the workers
running and safe to strand on a code-only rollback: `.141`'s code never reads
`kind`, `client_id`, `refresh_hash` or `refresh_token_expires_at`, and the two
new tables stay empty until somebody authorises a connector.

The four columns go on `arribada_mcp_token` rather than into a table of their
own because an OAuth access token IS one of those rows — same authentication
class, same three gates, same audit log. A separate table would have been a
second copy of every permission check, and a second copy of a permission is a
permission that stops agreeing with itself.

`('db', '0121_alter_estimate_type')` is the same upstream pin every migration in
this app uses. `db.User` and `db.Workspace` both long predate it.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0045_mcp_token"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="MCPOAuthClient",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("client_id", models.CharField(max_length=64, unique=True)),
                ("client_name", models.CharField(blank=True, default="", max_length=255)),
                ("redirect_uris", models.JSONField(default=list)),
                ("registered_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("registered_user_agent", models.CharField(blank=True, default="", max_length=512)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "MCP OAuth client",
                "verbose_name_plural": "MCP OAuth clients",
                "db_table": "arribada_mcp_oauth_client",
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddField(
            model_name="mcptoken",
            name="kind",
            field=models.CharField(
                choices=[("cli", "Issued from a shell"), ("oauth", "Issued by the OAuth flow")],
                default="cli",
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name="mcptoken",
            name="client",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="tokens",
                to="arribada.mcpoauthclient",
            ),
        ),
        migrations.AddField(
            model_name="mcptoken",
            name="refresh_hash",
            field=models.CharField(blank=True, db_index=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="mcptoken",
            name="refresh_expires_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="MCPAuthorizationCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("code_hash", models.CharField(max_length=64, unique=True)),
                ("redirect_uri", models.TextField()),
                ("code_challenge", models.CharField(max_length=128)),
                ("code_challenge_method", models.CharField(default="S256", max_length=8)),
                ("resource", models.TextField(blank=True, default="")),
                ("granted_scope", models.CharField(default="read", max_length=8)),
                ("granted_money", models.BooleanField(default=False)),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "client",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="codes",
                        to="arribada.mcpoauthclient",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mcp_oauth_codes",
                        to="db.user",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mcp_oauth_codes",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "MCP authorization code",
                "verbose_name_plural": "MCP authorization codes",
                "db_table": "arribada_mcp_authorization_code",
                "ordering": ("-created_at",),
            },
        ),
    ]
