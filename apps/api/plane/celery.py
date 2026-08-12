# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
import logging

# Third party imports
from celery import Celery
from pythonjsonlogger.jsonlogger import JsonFormatter
from celery.signals import after_setup_logger, after_setup_task_logger
from celery.schedules import crontab

# Module imports
from plane.settings.redis import redis_instance

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.production")

ri = redis_instance()

app = Celery("plane")

# Using a string here means the worker will not have to
# pickle the object when using Windows.
app.config_from_object("django.conf:settings", namespace="CELERY")

app.conf.beat_schedule = {
    # Intra day recurring jobs
    "check-every-five-minutes-to-send-email-notifications": {
        "task": "plane.bgtasks.email_notification_task.stack_email_notification",
        "schedule": crontab(minute="*/5"),  # Every 5 minutes
    },
    "run-every-6-hours-for-instance-trace": {
        "task": "plane.license.bgtasks.tracer.instance_traces",
        "schedule": crontab(hour="*/6", minute=0),  # Every 6 hours
    },
    # Occurs once every day
    "check-every-day-to-delete-hard-delete": {
        "task": "plane.bgtasks.deletion_task.hard_delete",
        "schedule": crontab(hour=0, minute=0),  # UTC 00:00
    },
    "check-every-day-to-archive-and-close": {
        "task": "plane.bgtasks.issue_automation_task.archive_and_close_old_issues",
        "schedule": crontab(hour=1, minute=0),  # UTC 01:00
    },
    "check-every-day-to-delete_exporter_history": {
        "task": "plane.bgtasks.exporter_expired_task.delete_old_s3_link",
        "schedule": crontab(hour=1, minute=30),  # UTC 01:30
    },
    "check-every-day-to-delete-file-asset": {
        "task": "plane.bgtasks.file_asset_task.delete_unuploaded_file_asset",
        "schedule": crontab(hour=2, minute=0),  # UTC 02:00
    },
    "check-every-day-to-delete-api-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_api_logs",
        "schedule": crontab(hour=2, minute=30),  # UTC 02:30
    },
    "check-every-day-to-delete-email-notification-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_email_notification_logs",
        "schedule": crontab(hour=2, minute=45),  # UTC 02:45
    },
    "check-every-day-to-delete-page-versions": {
        "task": "plane.bgtasks.cleanup_task.delete_page_versions",
        "schedule": crontab(hour=3, minute=0),  # UTC 03:00
    },
    "check-every-day-to-delete-issue-description-versions": {
        "task": "plane.bgtasks.cleanup_task.delete_issue_description_versions",
        "schedule": crontab(hour=3, minute=15),  # UTC 03:15
    },
    "check-every-day-to-delete-webhook-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_webhook_logs",
        "schedule": crontab(hour=3, minute=30),  # UTC 03:30
    },
    "check-every-day-to-delete-exporter-history": {
        "task": "plane.bgtasks.exporter_expired_task.delete_old_s3_link",
        "schedule": crontab(hour=3, minute=45),  # UTC 03:45
    },
    # ---------------------------------------------------------------- Arribada tasks
    #
    # `expire_seconds`, NOT `expires`. This instance runs django_celery_beat's
    # DatabaseScheduler (see beat_scheduler at the bottom of this file), and its
    # ModelEntry._unpack_options accepts exactly queue / exchange / routing_key /
    # priority / headers / expire_seconds. Anything else lands in **kwargs and is
    # DISCARDED IN SILENCE — the schedule would look correct in this file and set no
    # expiry at all, which is the same class of bug as a @shared_task on the wrong def.
    #
    # Why expiry matters here: nothing expired before, so a broker or worker outage ended
    # with every missed tick delivered at once into four prefork children. Each value below
    # is under its own interval, so a backlog collapses to one useful run instead of a
    # stampede. Retries, locks and the rest of the policy are in
    # plane/arribada/task_safety.py.
    "arribada-cycle-scope-snapshot": {
        "task": "plane.arribada.scope_snapshot_task.cycle_scope_snapshot",
        # 23:50 UTC: the last moment that is still today for the team, so the row
        # records the day as it ended rather than as it started.
        "schedule": crontab(hour=23, minute=50),
        # Forty-five minutes, and the number is bounded on BOTH sides — this is the
        # one entry in this schedule whose output is keyed on which day it is, so
        # neither a longer nor a shorter expiry is the safe direction.
        #
        # It read "an hour" and said, in a comment, that an hour stopped a delivery
        # arriving after midnight from stamping the wrong day. It did the opposite:
        # 23:50 plus an hour is 00:50, so the expiry ACCEPTED fifty minutes of
        # post-midnight delivery. The run then wrote its row under the new day, and
        # that day's own 23:50 run overwrote it — the day the tick was for ended
        # with no row at all, permanently, and nothing said so.
        #
        # Shrinking it to expire before midnight would have been the other half of
        # the same bug: a ten-minute window means any hiccup longer than ten minutes
        # — one retry under RETRY_POLICY, one `docker compose up -d` on the worker —
        # discards the tick, and the day is lost just as completely, only quietly.
        #
        # So the task learned to date itself instead (`_recorded_day` /
        # `LATE_TICK_GRACE` in scope_snapshot_task.py: anything in the first hour of
        # a day is a late delivery of the previous day's tick), and the expiry's job
        # is now simply to stay inside the window where that holds. 23:50 + 45 min =
        # 00:35, twenty-five minutes clear of the end of the grace, and celery
        # carries `expires` onto every retry so the whole chain is bounded by it.
        # `test_beat_schedule.py` pins both bounds against the task's own constant.
        "options": {"expire_seconds": 45 * 60},
    },
    "arribada-due-date-reminders": {
        "task": "plane.arribada.reminder_task.due_date_reminder",
        "schedule": crontab(hour=6, minute=0),  # UTC 06:00 daily
        # Four hours: a reminder that lands mid-morning is still the morning's reminder;
        # one that lands at midnight is noise, and the 20h dedup would suppress the next
        # day's real one.
        "options": {"expire_seconds": 4 * 3600},
    },
    "arribada-github-classification-warnings": {
        "task": "plane.arribada.github_classification_task.github_classification_warnings",
        "schedule": crontab(hour=6, minute=30),  # UTC 06:30 daily
        "options": {"expire_seconds": 4 * 3600},
    },
    "arribada-github-plane-sync": {
        "task": "plane.arribada.github_sync_task.github_plane_sync",
        "schedule": crontab(minute="*/30"),  # every 30 min — no-op until GITHUB_PAT is set
        # Under the 30-minute interval, so a queued backlog drops rather than replaying
        # hours of identical syncs. The task also takes a Redis lock, because expiry alone
        # does not stop two live deliveries overlapping.
        "options": {"expire_seconds": 25 * 60},
    },
    "arribada-notification-forward": {
        "task": "plane.arribada.notify_forward.forward_notifications",
        # Every 10 min, re-sending a 45-minute window. The dashboard drops what it
        # already holds, so overlap is the point: a missed tick costs a delay, not a
        # notification. No-op until ARRIBADA_NOTIFY_URL and _SECRET are set.
        "schedule": crontab(minute="*/10"),
        # Nine minutes. The window is 45 minutes wide, so a stale delivery can only
        # re-send what the next fresh run will send anyway.
        "options": {"expire_seconds": 9 * 60},
    },
}


# Setup logging
@after_setup_logger.connect
def setup_loggers(logger, *args, **kwargs):
    formatter = JsonFormatter('"%(levelname)s %(asctime)s %(module)s %(name)s %(message)s')
    handler = logging.StreamHandler()
    handler.setFormatter(fmt=formatter)
    logger.addHandler(handler)


@after_setup_task_logger.connect
def setup_task_loggers(logger, *args, **kwargs):
    formatter = JsonFormatter('"%(levelname)s %(asctime)s %(module)s %(name)s %(message)s')
    handler = logging.StreamHandler()
    handler.setFormatter(fmt=formatter)
    logger.addHandler(handler)


# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

app.conf.beat_scheduler = "django_celery_beat.schedulers.DatabaseScheduler"
