# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models


class Migration(migrations.Migration):
    """A cache of the person's country from the central profile, so the scheduler
    can skip the right public holidays without a network call.

    Blank by default, and blank means GB — applying this changes no plan.
    """

    dependencies = [("arribada", "0021_issue_artifact")]

    operations = [
        migrations.AddField(
            model_name="projectteammember",
            name="work_country",
            field=models.CharField(blank=True, default="", max_length=2),
        ),
    ]
