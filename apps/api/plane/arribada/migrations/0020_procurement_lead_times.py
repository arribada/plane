# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """A purchase can now say when it was ordered, when it is expected, when it
    arrived, and which work item is waiting for it — and a project can ask the
    scheduler to respect that.

    Every field is nullable or defaulted, and `schedule_from_deliveries` defaults
    to False, so applying this changes nothing about any existing plan.
    """

    dependencies = [
        ("arribada", "0019_issue_milestone"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectschedule",
            name="schedule_from_deliveries",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="order_reference",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="ordered_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="expected_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="received_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="procurementrequest",
            name="issue",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="arribada_procurement",
                to="db.issue",
            ),
        ),
        migrations.AlterField(
            model_name="procurementrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("ordered", "Ordered"),
                    ("received", "Received"),
                ],
                default="pending",
                max_length=16,
            ),
        ),
    ]
