# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.db import models


class ProjectSchedule(models.Model):
    """Planned start/target dates for a project.

    Upstream Plane has no project-level dates: PR #4355 added them in 2024 and the
    Community Edition later dropped them again. They are kept here, in a separate
    app with its own migration graph, rather than as fields on db.Project — so that
    upstream re-introducing Project.start_date can never collide with our schema.

    Dates are *planned* values, entered by a human. The portfolio view derives a
    second, read-only range from the project's work items (MIN start / MAX target);
    the gap between the two is what reveals drift.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.OneToOneField(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_schedule"
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_schedule"
        verbose_name = "Project schedule"
        verbose_name_plural = "Project schedules"

    def __str__(self):
        return f"{self.project_id} [{self.start_date} → {self.target_date}]"


class IssueBaseline(models.Model):
    """A frozen snapshot of an issue's planned dates, captured at a point in time.

    The gantt draws these as ghost bars behind the live bars so the drift between
    the committed plan and where things actually landed is visible. Same isolated-app
    pattern as ProjectSchedule: one row per issue, overwritten on re-capture.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.OneToOneField(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_baseline"
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    captured_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_issue_baseline"
        verbose_name = "Issue baseline"
        verbose_name_plural = "Issue baselines"

    def __str__(self):
        return f"baseline {self.issue_id} [{self.start_date} → {self.target_date}]"


class ProjectAffineDoc(models.Model):
    """Maps a Plane project to a doc in the self-hosted AFFiNE wiki (docs.arribada.org).

    The project's Pages section shows a private deep link to this doc — opened in a
    new tab where the user's own AFFiNE session applies, so nothing is published.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.OneToOneField(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_affine_doc"
    )
    workspace_id = models.CharField(max_length=64, default="5b320010-0d8d-4ccc-b4f6-dbe339c42b4e")
    doc_id = models.CharField(max_length=64, null=True, blank=True)
    title = models.CharField(max_length=512, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_affine_doc"
        verbose_name = "Project AFFiNE doc"
        verbose_name_plural = "Project AFFiNE docs"

    def __str__(self):
        return f"{self.project_id} -> affine {self.doc_id}"


class ProjectFolder(models.Model):
    """A workspace-shared folder to group projects in the sidebar (like AFFiNE).

    Shared, not per-user: a project lead organizes for the whole team. Nesting via
    a self-FK. Separate from Plane's per-user favorite folders and from
    ProjectUserProperty.sort_order (which stays the flat fallback order).
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="arribada_project_folders")
    name = models.CharField(max_length=255)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="children")
    sort_order = models.FloatField(default=65535)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_folder"
        ordering = ("sort_order",)
        verbose_name = "Project folder"
        verbose_name_plural = "Project folders"

    def __str__(self):
        return self.name


class ProjectFolderItem(models.Model):
    """Membership of a project in a shared folder, with intra-folder order."""

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    folder = models.ForeignKey(ProjectFolder, on_delete=models.CASCADE, related_name="items")
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="arribada_folder_item")
    sort_order = models.FloatField(default=65535)

    class Meta:
        db_table = "arribada_project_folder_item"
        ordering = ("sort_order",)
        verbose_name = "Project folder item"
        verbose_name_plural = "Project folder items"

    def __str__(self):
        return f"{self.project_id} in {self.folder_id}"
