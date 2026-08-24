# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A project's lifecycle status — Active / On hold / Completed / Cancelled.

Upstream Plane has no project lifecycle state (only archive), so there was no way
to say a project is finished, nor to filter the all-projects view by it. This adds
one, on ProjectSchedule rather than db.Project, for the same reason the dates and
budget live there: to keep our schema off the upstream model.

`default="active"` is the only safe value to deploy — every existing project is
ongoing until a human marks it otherwise, and the all-projects view keeps showing
them exactly as before until someone starts filtering.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("arribada", "0043_issue_external_source_index")]

    operations = [
        migrations.AddField(
            model_name="projectschedule",
            name="lifecycle_status",
            field=models.CharField(
                choices=[
                    ("active", "Active"),
                    ("on_hold", "On hold"),
                    ("completed", "Completed"),
                    ("cancelled", "Cancelled"),
                ],
                default="active",
                max_length=16,
            ),
        ),
    ]
