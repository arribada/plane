# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A fourth governance flag beside the three that were already there.

`default=False` is the only value that is safe to deploy: every project in
production has been running without this setting, and a migration that switched
it on would take the timeline away from every member of every project at the
moment the image rolled, with nobody having asked for it.

Reversible without a data function — dropping a boolean column loses only the
answer to a question the code on the other side of this migration does not ask.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("arribada", "0039_roster_lookup_indexes")]

    operations = [
        migrations.AddField(
            model_name="projectschedule",
            name="lead_only_edits",
            field=models.BooleanField(default=False),
        ),
    ]
