# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A third answer for the triage queue: decided, and decided to be nothing.

Filing was the only way off the queue, so an issue that belongs in no project
could only be cleared by putting it in one. These two columns let it be set
aside instead, and — because the sync reads them — kept there.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("arribada", "0033_issuechecklistitem"),
    ]

    operations = [
        migrations.AddField(
            model_name="githubissue",
            name="dismissed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="githubissue",
            name="dismissed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
