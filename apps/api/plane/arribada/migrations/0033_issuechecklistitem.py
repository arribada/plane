# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Checklist membership — a containment that is NOT a parent link.

A parent propagates into every list, board and timeline. Membership of a
checklist must not, which is why it is its own table rather than a reuse of
Issue.parent.
"""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("arribada", "0032_githubissue"),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueChecklistItem",
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
                ("sort_order", models.FloatField(default=65535)),
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
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_checklist_memberships",
                        to="db.issue",
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_checklist",
                        to="db.issue",
                    ),
                ),
            ],
            options={
                "verbose_name": "Checklist item",
                "verbose_name_plural": "Checklist items",
                "db_table": "arribada_issue_checklist_item",
                "ordering": ("sort_order",),
            },
        ),
        migrations.AddConstraint(
            model_name="issuechecklistitem",
            constraint=models.UniqueConstraint(
                fields=("owner", "member"), name="arribada_unique_checklist_pair"
            ),
        ),
        migrations.AddConstraint(
            model_name="issuechecklistitem",
            constraint=models.CheckConstraint(
                check=models.Q(("owner", models.F("member")), _negated=True),
                name="arribada_checklist_not_self",
            ),
        ),
    ]
