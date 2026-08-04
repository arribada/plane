# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Where an expense was bought, and what to reorder.

An expense line carried a label and a price, which is enough to total a budget
and not enough to buy the thing again. A manufacturer part number is what a
distributor's search box wants when the first batch has run out and nobody
remembers which module "GPS module — 10 off" meant; the link is where it came
from. Both optional: every line already recorded predates them.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0034_githubissue_dismissed"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectexpense",
            name="url",
            field=models.URLField(blank=True, default="", max_length=2000),
        ),
        migrations.AddField(
            model_name="projectexpense",
            name="manufacturer_part_number",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
