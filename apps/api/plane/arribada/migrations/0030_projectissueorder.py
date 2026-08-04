# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Named arrangements of a project's work items.

Plane has exactly one manual order — Issue.sort_order — which dragging rewrites
in place, so arranging a board for a review and then sorting by due date loses
the arrangement. This snapshots it under a name.
"""

import uuid

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("arribada", "0029_projectdiscipline"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectIssueOrder",
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
                ("name", models.CharField(max_length=80)),
                ("issue_ids", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_issue_orders",
                        to="db.project",
                    ),
                ),
            ],
            options={
                "verbose_name": "Saved work item order",
                "verbose_name_plural": "Saved work item orders",
                "db_table": "arribada_project_issue_order",
                "ordering": ("name",),
            },
        ),
        migrations.AddConstraint(
            model_name="projectissueorder",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("name"),
                models.F("project"),
                name="arribada_unique_order_name_per_project",
            ),
        ),
    ]
