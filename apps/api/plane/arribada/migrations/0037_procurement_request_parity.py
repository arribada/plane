# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The four fields a purchase request lost the moment it was approved.

ProcurementRequest was built to be the same shape as the expense line it becomes,
so that approval could be a copy rather than a translation. Four fields have
since been added to ProjectExpense and not to it, and each of them is one a
requester has in front of them and an approver does not: the distributor's link
and the manufacturer part number they were just looking at, the lead time the
supplier quoted them, and whether the thing they are asking for IS a work item's
whole cost rather than a purchase beside it.

Without these, "raise a request" and "record a line" were two different forms
with two different sets of fields, and the fields on only one of them quietly
vanished at the moment somebody said yes.

Hand-written. All four are nullable or defaulted, so on PostgreSQL this is a
metadata-only ALTER that does not rewrite the table.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0036_expense_work_item"),
    ]

    operations = [
        migrations.AddField(
            model_name="procurementrequest",
            name="url",
            field=models.URLField(blank=True, default="", max_length=2000),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="manufacturer_part_number",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="lead_time_days",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="replaces_labour",
            # Default False, not null: every request already recorded was for
            # parts a task waits on, never for the task itself. Approval has
            # always treated them that way, so the default is what they meant.
            field=models.BooleanField(default=False),
        ),
    ]
