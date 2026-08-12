# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A fifth governance flag, and NOT a second reading of the fourth.

`0040` added `lead_only_edits`: only the lead may change the plan. This adds
`external_edits`: whether a write that declares `external_source` may land here
at all. They are different questions about different callers, and the temptation
to answer the second with the first is the reason this column exists — a project
that protected its dates from its own members has said nothing whatsoever about
whether the wiki may file work items into it, and inferring one from the other
would hand out a permission nobody chose.

`default=False` is the only value that is safe to deploy, and it is a stronger
statement here than it was for `lead_only_edits`. There, False meant "carry on as
before". Here it means every project refuses declared external writes from the
moment this migration runs, so the sync writes nothing until a lead turns it on
per project — all 51 projects in the production workspace, measured 2026-08-12.
That is deliberate: the alternative is an integration granting itself write
access to all of them because an image rolled.

Nothing in production declares `external_source = 'arribada-wiki'` today (the 12
rows that carry an external source at all are the GitHub importer's), so this
migration changes the answer for no existing row. It changes what the NEXT write
gets told.

Reversible without a data function — dropping a boolean loses only the answer to
a question the code on the other side of this migration does not ask. No
RunPython, so no dump is needed ahead of it.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("arribada", "0041_project_wiki_doc_drive_links")]

    operations = [
        migrations.AddField(
            model_name="projectschedule",
            name="external_edits",
            field=models.BooleanField(default=False),
        ),
    ]
