# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The MCP credential table and its audit log.

Two new tables, no change to anything that exists, and **no `RunPython`** — so
there is no data function to reverse and nothing to dump ahead of. Reversing it
drops two tables that hold only credentials somebody can re-issue in one command
and a log of calls that have already happened.

Safe to apply with the workers running. Nothing in the `.90` image reads either
table, and nothing in this one reads them until a token exists — which requires
somebody to run `manage.py mcp_token issue`. A deploy that applies this and
stops has changed the behaviour of exactly nothing.

`('db', '0121_alter_estimate_type')` is the same upstream pin every other
migration in this app uses, rather than whatever the autodetector picks as the
newest. `db.User` and `db.Workspace` both long predate it, so the earlier pin is
equally correct and keeps all forty-five of our migrations hanging off ONE
upstream node — one conflict to resolve if upstream ever renumbers, instead of a
scattering of them.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models

import plane.arribada.mcp_models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0044_project_schedule_lifecycle_status"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="MCPToken",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("name", models.CharField(max_length=255)),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("prefix", models.CharField(max_length=24)),
                (
                    "scope",
                    models.CharField(
                        choices=[("read", "Read only"), ("write", "Read and write")],
                        default="read",
                        max_length=8,
                    ),
                ),
                ("allow_money", models.BooleanField(default=False)),
                ("project_ids", models.JSONField(blank=True, default=list)),
                (
                    "expires_at",
                    models.DateTimeField(default=plane.arribada.mcp_models.mcp_default_expiry),
                ),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="mcp_tokens_created",
                        to="db.user",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mcp_tokens",
                        to="db.user",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mcp_tokens",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "MCP token",
                "verbose_name_plural": "MCP tokens",
                "db_table": "arribada_mcp_token",
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="MCPCallLog",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("token_prefix", models.CharField(db_index=True, max_length=24)),
                ("tool", models.CharField(db_index=True, max_length=64)),
                ("arguments", models.TextField(blank=True, default="")),
                ("ok", models.BooleanField(default=True)),
                ("error", models.TextField(blank=True, default="")),
                ("duration_ms", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "token",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="calls",
                        to="arribada.mcptoken",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="mcp_calls",
                        to="db.user",
                    ),
                ),
            ],
            options={
                "verbose_name": "MCP call",
                "verbose_name_plural": "MCP calls",
                "db_table": "arribada_mcp_call_log",
                "ordering": ("-created_at",),
            },
        ),
    ]
