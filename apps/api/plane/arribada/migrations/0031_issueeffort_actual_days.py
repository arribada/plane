# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What a task actually took, beside what it was estimated at.

Kept apart from the estimate so the project can still answer "were we any good
at estimating" after the fact.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("arribada", "0030_projectissueorder")]

    operations = [
        migrations.AddField(
            model_name="issueeffort",
            name="actual_days",
            field=models.DecimalField(blank=True, decimal_places=1, max_digits=5, null=True),
        ),
    ]
