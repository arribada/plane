# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A work item that is somebody else's invoice rather than our time.

An expense line belonged to a project and to nothing smaller, so "hardware
production — six weeks, £4,000 to the supplier" had nowhere to be except as a
work item, where the budget costed its calendar span as about thirty person-days
of an internal rate. The project was then billed twice for the same thing.

`issue` links the ledger line to the item; `replaces_labour` says the line IS
that item's cost, which is what takes it out of the labour estimate and out of
everybody's capacity. `supplier` and `lead_time_days` are the two facts a fixed
price is useless without: who quoted it, and how long they said they would take.

Every field is nullable or defaulted and `replaces_labour` starts false, so every
line already recorded keeps meaning exactly what it meant.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0035_projectexpense_url_mpn"),
        # The FK target. Named explicitly rather than left to the graph: this app
        # has its own migration history and must not assume db's is applied. The
        # same anchor 0020 already uses for db.Issue.
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectexpense",
            name="issue",
            field=models.ForeignKey(
                blank=True,
                null=True,
                # Deleting a work item must not delete money the project
                # committed. The invoice outlives the task.
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="arribada_expenses",
                to="db.issue",
            ),
        ),
        migrations.AddField(
            model_name="projectexpense",
            name="replaces_labour",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="projectexpense",
            name="supplier",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="projectexpense",
            name="lead_time_days",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="projectexpense",
            index=models.Index(
                fields=["issue", "replaces_labour"], name="arribada_pr_issue_i_89f92e_idx"
            ),
        ),
    ]
