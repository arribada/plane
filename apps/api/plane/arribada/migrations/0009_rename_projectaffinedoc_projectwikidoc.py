# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Purge of AFFiNE/Mattermost naming: rename the model, its DB table and the
# chat-channel column IN PLACE. All operations are RenameModel / AlterModelTable
# / RenameField / AlterField — i.e. ALTER TABLE ... RENAME. No table is dropped
# or recreated, so the existing rows are preserved.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("arribada", "0008_projectaffinedoc_github_repo_urls"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="ProjectAffineDoc",
            new_name="ProjectWikiDoc",
        ),
        migrations.AlterModelTable(
            name="ProjectWikiDoc",
            table="arribada_project_wiki_doc",
        ),
        migrations.RenameField(
            model_name="ProjectWikiDoc",
            old_name="mattermost_channel_url",
            new_name="chat_url",
        ),
        migrations.AlterModelOptions(
            name="ProjectWikiDoc",
            options={
                "verbose_name": "Project wiki doc",
                "verbose_name_plural": "Project wiki docs",
            },
        ),
        migrations.AlterField(
            model_name="ProjectWikiDoc",
            name="project",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="arribada_wiki_doc",
                to="db.project",
            ),
        ),
    ]
