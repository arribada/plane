# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """A work item can point at the evidence for it — a wiki page, a Drive file, a
    GitHub URL — instead of the whole project's Drive folder being the answer."""

    dependencies = [
        ("arribada", "0020_procurement_lead_times"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueArtifact",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("wiki", "Wiki"),
                            ("drive", "Google Drive"),
                            ("github", "GitHub"),
                            ("other", "Other link"),
                        ],
                        default="other",
                        max_length=16,
                    ),
                ),
                ("url", models.URLField(max_length=2000)),
                ("label", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="db.user",
                    ),
                ),
                (
                    "issue",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_artifacts",
                        to="db.issue",
                    ),
                ),
            ],
            options={
                "verbose_name": "Issue artifact",
                "verbose_name_plural": "Issue artifacts",
                "db_table": "arribada_issue_artifact",
                "ordering": ("created_at",),
            },
        ),
    ]
