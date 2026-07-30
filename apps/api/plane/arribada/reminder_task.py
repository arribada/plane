# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Daily due-date reminders: upstream Plane never scans target_date, so a date
# that slips pings nobody. This creates an in-app notification for each assignee
# of a work item that is overdue / due today / due tomorrow, deduped so it fires
# at most once per issue+person per day. When a project has a Zulip channel
# (chat_url on its wiki doc) and the ARRIBADA_ZULIP_* env is set, it also posts a
# single compact reminder to that channel — reusing the same 20h dedup window so a
# channel gets at most one ping per issue per day.

import os
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from plane.arribada.zulip_notify import (
    is_enabled as zulip_enabled,
    post_to_stream as zulip_post,
    stream_id_from_chat_url,
)


@shared_task
def due_date_reminder():
    # imported here (not at module load) so registering the task in apps.ready()
    # never touches the model registry before it is ready
    from plane.db.models import Issue, IssueAssignee, Notification
    from plane.arribada.models import ProjectWikiDoc

    today = timezone.now().date()
    tomorrow = today + timedelta(days=1)
    since = timezone.now() - timedelta(hours=20)

    issues = list(
        Issue.issue_objects.filter(target_date__isnull=False, target_date__lte=tomorrow, deleted_at__isnull=True)
        .exclude(state__group__in=["completed", "cancelled"])
        .select_related("project", "project__workspace")
    )

    # Map each project -> its Zulip stream id, but only when chat posting is enabled and
    # the project's wiki doc carries a chat_url. Left empty (dormant) otherwise, so this
    # stays a pure in-app task by default with no extra queries or network calls.
    stream_by_project = {}
    if zulip_enabled() and issues:
        project_ids = {issue.project_id for issue in issues}
        for doc in ProjectWikiDoc.objects.filter(project_id__in=project_ids).exclude(chat_url__isnull=True):
            stream_id = stream_id_from_chat_url(doc.chat_url)
            if stream_id:
                stream_by_project[doc.project_id] = stream_id

    web_url = (os.environ.get("WEB_URL") or "https://plane.arribada.org").rstrip("/")

    created = 0
    zulip_sent = 0
    for issue in issues:
        if issue.target_date < today:
            label = "overdue"
        elif issue.target_date == today:
            label = "due today"
        else:
            label = "due tomorrow"

        posted_to_chat = False
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
            # First fresh notification for this issue in the 20h window => post one channel
            # reminder. Gating on the in-app dedup keeps the channel to one ping per issue/day.
            if not posted_to_chat:
                stream_id = stream_by_project.get(issue.project_id)
                if stream_id:
                    url = f"{web_url}/{issue.project.workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/"
                    content = f"🔔 **{issue.name}** — {label} (due {issue.target_date}). [Open in Plane]({url})"
                    if zulip_post(stream_id, "🔔 Échéances", content):
                        zulip_sent += 1
                posted_to_chat = True

    return {"reminders": created, "zulip": zulip_sent}
