# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The disciplines a project needs, recorded apart from who covers them.

Until now the vocabulary was inferred from the roster, which makes the one state
worth warning about unrepresentable: a project needing a trade nobody here has.
"""

import uuid

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("arribada", "0028_projectschedule_allow_add_items_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectDiscipline",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("name", models.CharField(max_length=80)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_disciplines",
                        to="db.project",
                    ),
                ),
            ],
            options={
                "verbose_name": "Project discipline",
                "verbose_name_plural": "Project disciplines",
                "db_table": "arribada_project_discipline",
                "ordering": ("name",),
            },
        ),
        migrations.AddConstraint(
            model_name="projectdiscipline",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("name"),
                models.F("project"),
                name="arribada_unique_discipline_per_project",
            ),
        ),
    ]
