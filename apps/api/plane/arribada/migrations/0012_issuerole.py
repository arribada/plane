# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0011_projectteammember'),
    ]

    operations = [
        migrations.CreateModel(
            name='IssueRole',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('role', models.CharField(max_length=80)),
                ('source', models.CharField(choices=[('manual', 'Manual'), ('ai', 'AI')], default='manual', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('issue', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_roles', to='db.issue')),
            ],
            options={
                'verbose_name': 'Issue role',
                'verbose_name_plural': 'Issue roles',
                'db_table': 'arribada_issue_role',
                'ordering': ('role',),
            },
        ),
        migrations.AddConstraint(
            model_name='issuerole',
            constraint=models.UniqueConstraint(
                fields=('issue', 'role'),
                name='arribada_issue_role_unique_issue_role',
            ),
        ),
    ]
