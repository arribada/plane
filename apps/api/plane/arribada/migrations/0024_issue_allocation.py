# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """How much of a person's time a work item takes, so the workload bar can have
    a denominator instead of being a rank.

    No row means 100%, so applying this changes nothing until somebody records a
    share.
    """

    dependencies = [
        ("arribada", "0023_versioned_baselines"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueAllocation",
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
                ("percent", models.PositiveSmallIntegerField(default=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "assignee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="+", to="db.user"
                    ),
                ),
                (
                    "issue",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_allocations",
                        to="db.issue",
                    ),
                ),
            ],
            options={
                "verbose_name": "Issue allocation",
                "verbose_name_plural": "Issue allocations",
                "db_table": "arribada_issue_allocation",
            },
        ),
        migrations.AddConstraint(
            model_name="issueallocation",
            constraint=models.UniqueConstraint(
                fields=("issue", "assignee"), name="arribada_issue_allocation_unique_pair"
            ),
        ),
    ]
