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

from plane.arribada.task_safety import BASE, HTTP_RETRY_POLICY, report_task_failure
from plane.arribada.zulip_notify import (
    is_enabled as zulip_enabled,
    post_to_stream as zulip_post,
    stream_id_from_chat_url,
)


def _summary_line(issue, label):
    """`Sea Turtle Tag · TAG-42 — overdue since 1 Aug (In progress)`.

    Project, work item and status, in that order, because that is the order a
    person triages in: whose is it, which one, how bad. Rendered as TEXT by the
    notification card — never as HTML — so a work item named `<img onerror=…>`
    is a work item with a silly name and nothing more.
    """
    ref = f"{issue.project.identifier}-{issue.sequence_id}"
    if label == "overdue":
        # `%-d` is glibc-only and this has to survive a non-Linux test runner.
        when = f"overdue since {issue.target_date.day} {issue.target_date:%b}"
    else:
        when = label
    state = issue.state.name if issue.state_id else None
    tail = f" ({state})" if state else ""
    return f"{issue.project.name} · {ref} — {when}{tail}"


@shared_task(**BASE, **HTTP_RETRY_POLICY)
def due_date_reminder(self):
    # `self` is here because HTTP_RETRY_POLICY sets bind=True; beat passes no arguments.
    #
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
        # `state` is joined for the summary line, not for the filter above: the
        # notification names the column the work item is sitting in, and reading
        # it lazily would be one extra query per assignee per day.
        .select_related("project", "project__workspace", "state")
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

    def _remind(issue):
        """Everything this task does for ONE work item.

        A function rather than the loop body it used to be, so the loop below can put a
        try/except around it. There was no guard of any kind here: one work item with a
        null project, a deleted workspace or an assignee row pointing at a removed user
        raised out of the whole task, and the reminders for every item after it in the
        list — this runs once a day, so those were not late, they never happened. Only
        `cycle_scope_snapshot` guarded per item; this one and the GitHub warnings had
        nothing.
        """
        nonlocal created, zulip_sent
        if issue.target_date < today:
            label = "overdue"
        elif issue.target_date == today:
            label = "due today"
        else:
            label = "due tomorrow"

        # What the card actually has to say: which project, which work item, what
        # state it is in. All four were already in hand here and none of them were
        # used — the title was "{issue.name} is overdue" and the body was the same
        # sentence again in bold, so the card said one thing twice and named
        # neither the project nor the column the item is sitting in.
        summary = _summary_line(issue, label)
        # `data.issue` is what the sidebar's second line reads. Left null before,
        # so every reminder rendered its subtitle as a bare hyphen: the component
        # interpolates `identifier`-`sequence_id` unconditionally.
        #
        # `id` is deliberately ABSENT. Plane treats `data.issue.id` as "peek this
        # work item in the pane", which needs project-member permissions loaded
        # and gives no room for anything the reminder itself says. Without it the
        # pane falls to this fork's own detail panel, which shows the summary and
        # links out to the work item via `entity_identifier` — set below.
        issue_data = {
            "issue": {
                "name": issue.name,
                "identifier": issue.project.identifier,
                "sequence_id": issue.sequence_id,
                "state_name": issue.state.name if issue.state_id else None,
            }
        }

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
                title=summary,
                data=issue_data,
                message={
                    "reminder": label,
                    "target_date": str(issue.target_date),
                    "project": issue.project.name,
                    "state": issue.state.name if issue.state_id else None,
                },
                # Empty on purpose, and this is the fix for a stored XSS as much as
                # for the duplicated sentence. The body used to interpolate
                # `issue.name` — user-editable text — straight into HTML that the
                # inbox renders with dangerouslySetInnerHTML. Nothing left to
                # escape is better than something escaped correctly today.
                message_html="",
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

    failed = 0
    for issue in issues:
        try:
            _remind(issue)
        except Exception as exc:  # noqa: BLE001
            # One bad work item must not cost everyone else the day's reminders. Reported
            # rather than swallowed, so the item that keeps failing is nameable.
            failed += 1
            report_task_failure(
                "plane.arribada.reminder_task.due_date_reminder",
                exc,
                note=f"work item `{issue.id}` skipped; the rest of the run continued",
            )

    return {"reminders": created, "zulip": zulip_sent, "failed": failed}
