# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='IssueBaseline',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('start_date', models.DateField(blank=True, null=True)),
                ('target_date', models.DateField(blank=True, null=True)),
                ('captured_at', models.DateTimeField(auto_now=True)),
                ('issue', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_baseline', to='db.issue')),
            ],
            options={
                'verbose_name': 'Issue baseline',
                'verbose_name_plural': 'Issue baselines',
                'db_table': 'arribada_issue_baseline',
            },
        ),
    ]
