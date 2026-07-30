# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0009_rename_projectaffinedoc_projectwikidoc'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkspaceAiSettings',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('provider', models.CharField(default='groq', max_length=32)),
                ('model', models.CharField(blank=True, default='', max_length=128)),
                ('base_url', models.CharField(blank=True, default='', max_length=512)),
                ('encrypted_api_key', models.TextField(blank=True, default='')),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='db.user')),
                ('workspace', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_ai_settings', to='db.workspace')),
            ],
            options={
                'verbose_name': 'Workspace AI settings',
                'verbose_name_plural': 'Workspace AI settings',
                'db_table': 'arribada_workspace_ai_settings',
            },
        ),
    ]
