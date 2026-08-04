# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The raw GitHub issue, kept whole.

The sync read a title and a URL and discarded the rest, which put a floor under
how well anything could ever be pre-filled. This is the record everything else
about triage will be built on. Additive: nothing reads it yet.
"""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("arribada", "0031_issueeffort_actual_days"),
    ]

    operations = [
        migrations.CreateModel(
            name="GithubIssue",
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
                ("repo", models.CharField(db_index=True, max_length=255)),
                ("number", models.IntegerField()),
                ("title", models.CharField(max_length=512)),
                ("body", models.TextField(blank=True, default="")),
                ("html_url", models.CharField(max_length=1024)),
                ("labels", models.JSONField(blank=True, default=list)),
                ("github_assignees", models.JSONField(blank=True, default=list)),
                ("milestone", models.CharField(blank=True, default="", max_length=255)),
                ("state", models.CharField(default="open", max_length=32)),
                ("github_created_at", models.DateTimeField(blank=True, null=True)),
                ("github_closed_at", models.DateTimeField(blank=True, null=True)),
                ("github_updated_at", models.DateTimeField(blank=True, null=True)),
                ("filed_at", models.DateTimeField(blank=True, null=True)),
                ("filed_by_rule", models.CharField(blank=True, default="", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "filed_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "filed_issue",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="db.issue",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_github_issues",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "GitHub issue",
                "verbose_name_plural": "GitHub issues",
                "db_table": "arribada_github_issue",
                "ordering": ("-github_created_at",),
            },
        ),
        migrations.AddConstraint(
            model_name="githubissue",
            constraint=models.UniqueConstraint(
                fields=("workspace", "repo", "number"), name="arribada_unique_github_issue"
            ),
        ),
    ]
