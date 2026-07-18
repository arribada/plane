# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Daily due-date reminders: upstream Plane never scans target_date, so a date
# that slips pings nobody. This creates an in-app notification for each assignee
# of a work item that is overdue / due today / due tomorrow, deduped so it fires
# at most once per issue+person per day.

from datetime import timedelta

from celery import shared_task
from django.utils import timezone


@shared_task
def due_date_reminder():
    # imported here (not at module load) so registering the task in apps.ready()
    # never touches the model registry before it is ready
    from plane.db.models import Issue, IssueAssignee, Notification

    today = timezone.now().date()
    tomorrow = today + timedelta(days=1)
    since = timezone.now() - timedelta(hours=20)

    issues = (
        Issue.issue_objects.filter(target_date__isnull=False, target_date__lte=tomorrow, deleted_at__isnull=True)
        .exclude(state__group__in=["completed", "cancelled"])
        .select_related("project", "project__workspace")
    )

    created = 0
    for issue in issues:
        if issue.target_date < today:
            label = "overdue"
        elif issue.target_date == today:
            label = "due today"
        else:
            label = "due tomorrow"
        for uid in IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True):
            already = Notification.objects.filter(
                receiver_id=uid,
                entity_identifier=issue.id,
                sender="in_app:reminder",
                created_at__gte=since,
            ).exists()
            if already:
                continue
            Notification.objects.create(
                workspace=issue.project.workspace,
                project=issue.project,
                sender="in_app:reminder",
                receiver_id=uid,
                entity_identifier=issue.id,
                entity_name="issue",
                title=f"{issue.name} is {label}",
                message={"reminder": label, "target_date": str(issue.target_date)},
                message_html=f"<p><b>{issue.name}</b> is {label} — due {issue.target_date}.</p>",
            )
            created += 1
    return {"reminders": created}
