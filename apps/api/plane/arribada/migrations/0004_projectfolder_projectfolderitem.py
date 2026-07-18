# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0003_projectaffinedoc'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectFolder',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('name', models.CharField(max_length=255)),
                ('sort_order', models.FloatField(default=65535)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='arribada.projectfolder')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_project_folders', to='db.workspace')),
            ],
            options={
                'verbose_name': 'Project folder',
                'verbose_name_plural': 'Project folders',
                'db_table': 'arribada_project_folder',
                'ordering': ('sort_order',),
            },
        ),
        migrations.CreateModel(
            name='ProjectFolderItem',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('sort_order', models.FloatField(default=65535)),
                ('folder', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='arribada.projectfolder')),
                ('project', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_folder_item', to='db.project')),
            ],
            options={
                'verbose_name': 'Project folder item',
                'verbose_name_plural': 'Project folder items',
                'db_table': 'arribada_project_folder_item',
                'ordering': ('sort_order',),
            },
        ),
    ]
