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
