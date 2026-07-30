# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0121_alter_estimate_type'),
        ('arribada', '0010_workspaceaisettings'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectTeamMember',
            fields=[
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('name', models.CharField(max_length=255)),
                ('email', models.CharField(blank=True, default='', max_length=255)),
                ('roles', models.JSONField(blank=True, default=list)),
                ('is_lead', models.BooleanField(default=False)),
                ('source', models.CharField(choices=[('manual', 'Manual'), ('wiki', 'Wiki')], default='manual', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='db.user')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='arribada_team', to='db.project')),
            ],
            options={
                'verbose_name': 'Project team member',
                'verbose_name_plural': 'Project team members',
                'db_table': 'arribada_project_team_member',
                'ordering': ('-is_lead', 'name'),
            },
        ),
        migrations.AddConstraint(
            model_name='projectteammember',
            constraint=models.UniqueConstraint(
                condition=models.Q(('email', ''), _negated=True),
                fields=('project', 'email'),
                name='arribada_team_unique_project_email',
            ),
        ),
        migrations.AddConstraint(
            model_name='projectteammember',
            constraint=models.UniqueConstraint(
                condition=models.Q(('email', '')),
                fields=('project', 'name'),
                name='arribada_team_unique_project_name',
            ),
        ),
    ]
