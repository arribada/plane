# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('arribada', '0007_projectaffinedoc_mattermost_channel_url'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectaffinedoc',
            name='github_repo_urls',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
