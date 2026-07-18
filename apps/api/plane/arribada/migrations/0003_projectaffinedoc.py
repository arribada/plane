# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0002_issuebaseline'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectAffineDoc',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('workspace_id', models.CharField(default='5b320010-0d8d-4ccc-b4f6-dbe339c42b4e', max_length=64)),
                ('doc_id', models.CharField(blank=True, max_length=64, null=True)),
                ('title', models.CharField(blank=True, max_length=512, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('project', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_affine_doc', to='db.project')),
            ],
            options={
                'verbose_name': 'Project AFFiNE doc',
                'verbose_name_plural': 'Project AFFiNE docs',
                'db_table': 'arribada_project_affine_doc',
            },
        ),
    ]
