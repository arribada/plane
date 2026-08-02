# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """What a cycle held on a given day, so a burndown can show scope creep instead
    of silently rewriting its own past."""

    dependencies = [
        ("arribada", "0024_issue_allocation"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="CycleScopeSnapshot",
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
                ("date", models.DateField()),
                ("total", models.PositiveIntegerField(default=0)),
                ("completed", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "cycle",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_scope_snapshots",
                        to="db.cycle",
                    ),
                ),
            ],
            options={
                "verbose_name": "Cycle scope snapshot",
                "verbose_name_plural": "Cycle scope snapshots",
                "db_table": "arribada_cycle_scope_snapshot",
                "ordering": ("date",),
            },
        ),
        migrations.AddConstraint(
            model_name="cyclescopesnapshot",
            constraint=models.UniqueConstraint(fields=("cycle", "date"), name="arribada_cycle_scope_unique_day"),
        ),
    ]
