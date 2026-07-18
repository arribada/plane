# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('arribada', '0005_projectstatusupdate'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectaffinedoc',
            name='google_drive_url',
            field=models.CharField(blank=True, max_length=1024, null=True),
        ),
    ]
