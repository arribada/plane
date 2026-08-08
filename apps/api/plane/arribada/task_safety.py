# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The safety net the fork's five scheduled tasks were running without.

Before this module none of `cycle_scope_snapshot`, `due_date_reminder`,
`github_classification_warnings`, `github_plane_sync` or `forward_notifications` had
`bind=True`, `autoretry_for`, `max_retries`, `acks_late` or `expires`, and there was no lock
of any kind anywhere in the fork. Three consequences, all of them silent:

* **A worker killed mid-task lost that run permanently.** With the default `acks_late=False`
  RabbitMQ acknowledges the message the moment it is delivered, so a deploy, an OOM kill or a
  SIGKILL between delivery and completion drops the job. Nothing retries it, nothing records
  that it vanished, and the only symptom is a row that was never written.

* **After an outage every missed tick fired at once.** Beat re-sends on catch-up and nothing
  expired, so a broker that had been unreachable for six hours handed the worker twelve
  `github_plane_sync` messages, which the four prefork children then ran CONCURRENTLY. That
  sync is check-then-act throughout (`Issue.objects.filter(external_source=…, external_id=…)
  .first()` then `create`) with no unique constraint behind it, so two runs racing create two
  work items for one GitHub issue — and a duplicate is somebody's afternoon to unpick.

* **Nothing ever told a human.** There is no Sentry in this codebase (`grep -i sentry` over
  `apps/api` returns nothing). Four of the five tasks let exceptions escape into Celery's own
  logger rather than `log_exception`, which is why `plane_logs_beat/plane-error.log` has been
  0 bytes since 2026-07-10 — the file handler is wired to the `plane.exception` logger and
  nothing was calling it. And container logs are destroyed by every deploy, so even the
  console copy has a lifetime measured in days.

What this module adds:

* `RETRY_POLICY` / `HTTP_RETRY_POLICY` — the decorator options, following upstream's own
  pattern at `plane/bgtasks/webhook_task.py:254-258`.
* `ArribadaTask` — a base whose `on_failure` routes a dead run somewhere a person will see it.
* `report_task_failure` — that route: `log_exception` (durable file + console) plus a Zulip
  post when `ARRIBADA_ZULIP_*` is configured, which it is in production. Never raises.
* `task_lock` — a Redis lock, so overlapping runs of the same task cannot race.

`expires` is deliberately NOT here: see the note in `plane/celery.py`, where it has to be
spelled `expire_seconds` because this instance runs `django_celery_beat`'s DatabaseScheduler.
"""

import logging
import os
import uuid
from contextlib import contextmanager

import requests
from celery import Task
from django.db import InterfaceError, OperationalError

from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane.arribada.tasks")

# Stream that hears about a task that died. A NAME, not an id: Zulip's message API accepts
# either for `to`, and "alerts" is already the stream Uptime-Kuma posts to, so a failure lands
# next to the infrastructure alert that probably caused it.
ALERT_STREAM = os.environ.get("ARRIBADA_TASK_ALERT_STREAM", "alerts")
ALERT_TOPIC = os.environ.get("ARRIBADA_TASK_ALERT_TOPIC", "plane tasks")

# Worth retrying because the next attempt can plausibly succeed.
#
# OperationalError/InterfaceError are the Postgres blip family — connection reset, server
# restarting, "server closed the connection unexpectedly". They matter more now than they did:
# CONN_MAX_AGE is no longer 0 (see settings/common.py), so a connection survives between
# tasks and a Postgres restart is felt as a stale socket on the first query after it.
#
# NOT retried, on purpose: IntegrityError, ValueError, TypeError, AttributeError. Those are
# bugs or bad data, and a bug retried five times is the same bug five times plus a delay.
RETRYABLE_DB = (OperationalError, InterfaceError)
# `socket.timeout` is not listed: since Python 3.10 it IS `TimeoutError`, and naming both
# would only look like two guarantees where there is one.
RETRYABLE_HTTP = (requests.RequestException, TimeoutError)

# Follows upstream's webhook_send_task: exponential backoff with jitter, a small ceiling on
# attempts. `acks_late` is the half that survives a killed worker — the message is only
# acknowledged once the task returns, so a SIGKILL puts it back on the queue instead of
# dropping it. `reject_on_worker_lost` is what makes that redelivery actually happen rather
# than the message being ack'd by the dying process's channel teardown.
#
# acks_late is safe for all five of these because every one of them is idempotent: the
# snapshot uses update_or_create keyed on (cycle, date); both notification tasks dedupe on a
# 20-hour window before writing; the forwarder is deduped by the dashboard on `external_id`;
# and the GitHub sync re-reads its own state each run. Do not copy this policy onto a task
# that appends.
RETRY_POLICY = {
    "bind": True,
    "autoretry_for": RETRYABLE_DB,
    "max_retries": 3,
    "retry_backoff": 60,
    "retry_backoff_max": 900,
    "retry_jitter": True,
    "acks_late": True,
    "reject_on_worker_lost": True,
}

# Same, for the tasks that also talk to something over the network.
HTTP_RETRY_POLICY = dict(RETRY_POLICY, autoretry_for=RETRYABLE_DB + RETRYABLE_HTTP)


def report_task_failure(task_name, exc, note=None):
    """Put a dead task run somewhere that outlives the container.

    `log_exception` writes through the `plane.exception` logger, which production wires to
    BOTH the console and the rotating file handler — the file that has been empty since July
    because nothing in this app was calling it.

    The Zulip post is the part a person actually sees. It is best-effort by construction: a
    failure sink that can itself fail loudly would turn one broken task into two, so every
    error in here is swallowed after being logged.
    """
    try:
        log_exception(exc)
    except Exception:  # noqa: BLE001 — the sink must never be the thing that breaks
        logger.exception("log_exception failed while reporting %s", task_name)

    try:
        from plane.arribada import zulip_notify

        if not zulip_notify.is_enabled():
            return
        detail = f"\n{note}" if note else ""
        zulip_notify.post_to_stream(
            ALERT_STREAM,
            ALERT_TOPIC,
            f"🔴 **{task_name}** failed: `{type(exc).__name__}: {str(exc)[:400]}`{detail}",
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not report the failure of %s to chat", task_name)


class ArribadaTask(Task):
    """Base for this fork's scheduled tasks: a failure gets reported instead of evaporating.

    `on_failure` fires once, after retries are exhausted (or immediately for an exception
    outside `autoretry_for`). It is the only hook that sees BOTH kinds of death, which is why
    the reporting lives here rather than in a try/except around each body.
    """

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        report_task_failure(self.name, exc, note=f"task_id `{task_id}`")
        return super().on_failure(exc, task_id, args, kwargs, einfo)


BASE = {"base": ArribadaTask}


@contextmanager
def task_lock(name, timeout):
    """`with task_lock("x", 900) as held:` — `held` is False when someone else holds it.

    Why a lock at all: after a broker outage beat delivers every missed tick at once and the
    worker runs them in parallel across its prefork children. `github_plane_sync` reads
    "does a work item already exist for this GitHub id?" and then creates one if not, with no
    unique constraint underneath — two concurrent runs both read "no" and both create.

    Uses `SET key value NX PX ttl`, which is atomic, and releases only if the value still
    matches this run's token, so a run that overshot its TTL cannot delete the lock a later
    run legitimately took.

    Redis being unreachable yields True (proceed). A cache outage must not stop the scheduled
    work — the same judgement as IGNORE_EXCEPTIONS on the Django cache. Losing the lock costs
    a possible duplicate; refusing to run costs the day's data.
    """
    token = uuid.uuid4().hex
    key = f"arribada:lock:{name}"
    client = None
    try:
        from plane.settings.redis import redis_instance

        client = redis_instance()
        acquired = bool(client.set(key, token, nx=True, px=int(timeout * 1000)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("task_lock(%s): redis unavailable (%s) — running unlocked", name, exc)
        yield True
        return

    if not acquired:
        logger.info("task_lock(%s): already held, skipping this run", name)
        yield False
        return

    try:
        yield True
    finally:
        try:
            # Compare-and-delete, so a slow run that has already lost the lock by TTL does
            # not delete the one its successor is holding.
            client.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                key,
                token,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("task_lock(%s): could not release (%s) — expires in %ss", name, exc, timeout)
