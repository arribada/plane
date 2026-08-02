# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.db import migrations, models


def carry_existing_baselines_forward(apps, schema_editor):
    """Everything already frozen becomes each project's "Initial baseline".

    The old model was one row per work item, overwritten on re-capture. Those rows
    ARE a real committed plan for whichever projects were frozen, and discarding
    them would throw away the only record of what was promised. They are grouped
    by project, given a name and the newest capture time they carry, and left
    alone afterwards — the old table is not dropped in this migration, so a
    rollback loses nothing.
    """
    IssueBaseline = apps.get_model("arribada", "IssueBaseline")
    ProjectBaseline = apps.get_model("arribada", "ProjectBaseline")
    BaselineEntry = apps.get_model("arribada", "BaselineEntry")

    by_project = {}
    for row in IssueBaseline.objects.select_related("issue").all():
        issue = row.issue
        if not issue or not issue.project_id:
            continue
        by_project.setdefault(issue.project_id, []).append((row, issue))

    for project_id, rows in by_project.items():
        # The newest capture in the group: the old field was auto_now, so it says
        # when that item was last re-frozen, and the group's plan is only as old as
        # its most recent write.
        captured = max((r.captured_at for r, _ in rows if r.captured_at), default=None)
        baseline = ProjectBaseline.objects.create(
            id=uuid.uuid4(),
            project_id=project_id,
            name="Initial baseline",
            note="Carried over from the single per-item baseline this fork kept before named snapshots existed.",
        )
        if captured:
            # auto_now_add ignores an assigned value, so the honest capture time has
            # to be written back afterwards.
            ProjectBaseline.objects.filter(id=baseline.id).update(captured_at=captured)

        BaselineEntry.objects.bulk_create(
            [
                BaselineEntry(
                    id=uuid.uuid4(),
                    baseline_id=baseline.id,
                    issue_id=issue.id,
                    issue_name=(issue.name or "")[:255],
                    start_date=row.start_date,
                    target_date=row.target_date,
                )
                for row, issue in rows
            ],
            batch_size=500,
        )


def drop_carried_baselines(apps, schema_editor):
    """Reverse: remove only what this migration created, by its name."""
    ProjectBaseline = apps.get_model("arribada", "ProjectBaseline")
    ProjectBaseline.objects.filter(name="Initial baseline").delete()


class Migration(migrations.Migration):
    """Baselines become named, dated snapshots a project can hold several of.

    A funder asking "what did you promise" needs to be shown WHICH plan. The old
    single row per work item could not answer that: re-freezing overwrote it.
    """

    dependencies = [
        ("arribada", "0022_team_member_country"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectBaseline",
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
                ("name", models.CharField(max_length=255)),
                ("captured_at", models.DateTimeField(auto_now_add=True)),
                ("note", models.TextField(blank=True, default="")),
                (
                    "captured_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="db.user",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_baselines",
                        to="db.project",
                    ),
                ),
            ],
            options={
                "verbose_name": "Project baseline",
                "verbose_name_plural": "Project baselines",
                "db_table": "arribada_project_baseline",
                "ordering": ("-captured_at",),
            },
        ),
        migrations.CreateModel(
            name="BaselineEntry",
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
                ("issue_name", models.CharField(blank=True, default="", max_length=255)),
                ("start_date", models.DateField(blank=True, null=True)),
                ("target_date", models.DateField(blank=True, null=True)),
                (
                    "baseline",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="entries",
                        to="arribada.projectbaseline",
                    ),
                ),
                (
                    "issue",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="arribada_baseline_entries",
                        to="db.issue",
                    ),
                ),
            ],
            options={
                "verbose_name": "Baseline entry",
                "verbose_name_plural": "Baseline entries",
                "db_table": "arribada_baseline_entry",
            },
        ),
        migrations.AddConstraint(
            model_name="baselineentry",
            constraint=models.UniqueConstraint(
                fields=("baseline", "issue"), name="arribada_baseline_entry_unique_issue"
            ),
        ),
        migrations.RunPython(carry_existing_baselines_forward, drop_carried_baselines),
    ]
