# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """A work item can now say it is a deliverable, instead of it being guessed
    from a zero-day duration."""

    dependencies = [
        ("arribada", "0018_workspace_currency_settings"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueMilestone",
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
                        choices=[("gate", "Gate"), ("delivery", "Delivery"), ("review", "Review")],
                        default="delivery",
                        max_length=16,
                    ),
                ),
                ("label", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "issue",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_milestone",
                        to="db.issue",
                    ),
                ),
            ],
            options={
                "verbose_name": "Issue milestone",
                "verbose_name_plural": "Issue milestones",
                "db_table": "arribada_issue_milestone",
                "ordering": ("created_at",),
            },
        ),
    ]
