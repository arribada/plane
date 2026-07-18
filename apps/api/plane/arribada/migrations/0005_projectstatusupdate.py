# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0004_projectfolder_projectfolderitem'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectStatusUpdate',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('status', models.CharField(choices=[('on_track', 'On track'), ('at_risk', 'At risk'), ('off_track', 'Off track')], default='on_track', max_length=16)),
                ('message', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='db.user')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_status_updates', to='db.project')),
            ],
            options={
                'verbose_name': 'Project status update',
                'verbose_name_plural': 'Project status updates',
                'db_table': 'arribada_project_status_update',
                'ordering': ('-created_at',),
            },
        ),
    ]
