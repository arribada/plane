# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What happens when a webhook endpoint stops answering — the policy, kept out of upstream.

Upstream `webhook_send_task` had one response to failure: after a SINGLE delivery
exhausted its five retries it set `Webhook.is_active = False` and emailed whoever created
the webhook. Three things are wrong with that, and they compound.

* **It is a silent deactivation.** The integration stops, the row's boolean flips, and
  nothing that a person watches changes. The email is the whole of the notice, and this
  fork's own audit is the reason to distrust it: the durable error log sat at zero bytes
  for a month because four of five scheduled tasks logged nowhere a human looked. An
  alert nobody reads is indistinguishable from no alert.
* **It cannot tell an outage from a deletion.** A wiki container restarting, a droplet
  rebooting, a certificate expiring over a weekend — all of them are "the endpoint did
  not answer", and all of them end the integration permanently, requiring a person who
  does not know it happened to go and turn it back on.
* **Recovery is manual and undiscoverable.** Nothing re-arms. The sync is off until
  somebody notices the pages have gone stale, which is exactly the months-later failure
  this integration was told to avoid.

The opposite extreme is not right either, and saying "never deactivate" without saying
what replaces it just moves the failure. An endpoint that is gone forever, retried
forever, is a queue that grows with event volume — and this fork has already been bitten
once by an unbounded retry loop.

## The policy

The resolution is to separate the two things upstream conflated: **how long an event
keeps trying**, and **how often we touch a suspect endpoint**. Bound the first, and the
second stops scaling with event volume.

* Each delivery keeps upstream's retry ceiling exactly as it was — five retries,
  exponential backoff, jitter. An event that cannot be delivered inside that window is
  dropped. That is the bound, it is unchanged, and it is what keeps the queue finite.
* Across deliveries, consecutive failed ATTEMPTS are counted on the endpoint. At
  `OPEN_AFTER_FAILURES` the breaker opens.
* While open, deliveries stop making HTTP requests. They raise `CircuitOpen` and retry on
  their own existing backoff, so an event still goes out the moment the endpoint returns —
  nothing is dropped that would not have been dropped anyway.
* One delivery per `PROBE_INTERVAL_SECONDS` is let through as a probe. Any 2xx closes the
  breaker, resets the counter and announces the recovery. No human action.
* `Webhook.is_active` is never written. A human remains the only thing that can turn a
  webhook off, which is the whole point.

So the load on a dead endpoint is one request per probe interval — a constant, independent
of how busy the workspace is — and the load on the queue is bounded by the per-delivery
retry ceiling that was already there. "Never deactivate" is affordable precisely because
the probe rate is decoupled from the event rate.

## Where a person hears about it

`task_safety.report_task_failure`, which is already the route this fork uses for a dead
scheduled run: `log_exception` to the durable file, and a Zulip post to the `alerts`
stream that Uptime-Kuma already writes to. Reusing it rather than adding a third channel
means an endpoint going dark lands next to the infrastructure alert that probably caused
it. Recovery is posted the same way — same stream, same topic, different wording, because
routing a good-news message through a function that prefixes everything with a red circle
would be worse than not sending it.

Every function here is best-effort by construction. Health tracking that can itself throw
would turn a wiki outage into a broken webhook task, so failures are logged and swallowed,
and `should_attempt` fails OPEN — if we cannot read the breaker we deliver. The same
judgement as `task_lock` on an unreachable Redis: losing the guard costs one wasted
request, refusing to run costs the event.
"""

import logging
from datetime import timedelta

import requests
from django.db.models import Q
from django.utils import timezone

from plane.arribada.task_safety import ALERT_STREAM, ALERT_TOPIC, report_task_failure

logger = logging.getLogger("plane.arribada.webhook")


# Consecutive failed attempts before the breaker opens.
#
# Five, because a failure here is one failed HTTP ATTEMPT and the streak resets on any
# success. One event the receiver chokes on cannot reach five: it fails its own six
# attempts spread over hours while every other event succeeds in between and puts the
# counter back to zero. The streak only climbs when nothing is getting through at all,
# so five consecutive means the endpoint has refused everything we have sent it, with no
# success anywhere in between — which is a property of the endpoint, not of one payload.
#
# It is deliberately not larger. Opening the breaker is cheap and self-reversing, so the
# cost of opening early is at most one probe interval of delay; the cost of opening late
# is a stream of doomed requests at somebody else's server.
OPEN_AFTER_FAILURES = 5

# How often a probe is allowed through while the breaker is open.
#
# Fifteen minutes, because that is the cadence of the polling this webhook replaces. It
# makes the worst case explicit and easy to reason about: while the endpoint is down, the
# integration is no staler than it was before webhooks existed. Ninety-six probes a day
# is nothing, and it is a fixed cost — a workspace generating a thousand events an hour
# probes exactly as often as an idle one.
PROBE_INTERVAL_SECONDS = 15 * 60

# How often a still-open breaker says so again.
#
# Six hours: an outage that outlives a working day should re-announce itself, because the
# message that opened the breaker may have arrived at 03:00. More often than this and it
# becomes noise, and a muted channel is the silence this module exists to remove. At most
# four messages a day per broken endpoint.
REALERT_AFTER_SECONDS = 6 * 60 * 60


class CircuitOpen(requests.RequestException):
    """Raised instead of making a request to an endpoint that is known to be failing.

    A `RequestException` on purpose: upstream's task already declares
    `autoretry_for=(requests.RequestException,)`, so this rides the retry policy that is
    already there rather than adding a second one. The delivery waits and is sent when a
    probe closes the breaker.
    """


def _health_model():
    """Imported lazily so this module can be imported from `plane.bgtasks` without a cycle."""
    from plane.arribada.models import WebhookDeliveryHealth

    return WebhookDeliveryHealth


def _describe(webhook):
    """`slug → url`, the two things worth having in an alert about a webhook."""
    try:
        return f"{webhook.workspace.slug} → {webhook.url}"
    except Exception:  # noqa: BLE001 — an alert must not need a join to be sendable
        return str(getattr(webhook, "url", webhook))


def should_attempt(webhook):
    """False when the breaker is open and this delivery is not the probe.

    Fails OPEN. Any error reading the state returns True, because a health table we cannot
    query is not a reason to stop delivering events.

    The probe is claimed with a conditional UPDATE rather than a read-then-write, so that
    several workers arriving together cannot all decide they are the one probe. Postgres
    settles it: exactly one UPDATE matches the row while `last_probe_at` is still stale,
    and `.update()` returns the number of rows it changed.
    """
    try:
        health = _health_model()
        row = health.objects.filter(webhook_id=webhook.id).only("id", "circuit_open").first()
        if row is None or not row.circuit_open:
            return True

        cutoff = timezone.now() - timedelta(seconds=PROBE_INTERVAL_SECONDS)
        claimed = health.objects.filter(
            Q(last_probe_at__lt=cutoff) | Q(last_probe_at__isnull=True), pk=row.pk
        ).update(last_probe_at=timezone.now())
        if claimed:
            logger.info("webhook %s: circuit open, sending a probe", webhook.id)
        return bool(claimed)
    except Exception as exc:  # noqa: BLE001
        logger.warning("webhook %s: could not read delivery health (%s) — attempting anyway", webhook.id, exc)
        return True


def record_failure(webhook, exc):
    """Count one failed attempt, and open the breaker if the endpoint has stopped answering.

    Called for every failed attempt, including retries of the same delivery — see the note
    on `WebhookDeliveryHealth.consecutive_failures` for why attempts rather than deliveries
    are the right unit.
    """
    try:
        health = _health_model()
        now = timezone.now()
        row, created = health.objects.get_or_create(
            webhook_id=webhook.id,
            defaults={"first_failure_at": now},
        )
        if created or row.first_failure_at is None:
            row.first_failure_at = now
        row.consecutive_failures = (row.consecutive_failures or 0) + 1
        row.last_failure_at = now
        row.last_error = f"{type(exc).__name__}: {exc}"[:2000]

        just_opened = False
        if not row.circuit_open and row.consecutive_failures >= OPEN_AFTER_FAILURES:
            row.circuit_open = True
            row.opened_at = now
            # The probe clock starts NOW, not at zero. The attempt that just failed is the
            # most recent evidence we have, so the next request is due one interval after
            # it — leaving this null would open the breaker and then immediately probe,
            # which is one more request at a server we have this second decided to stop
            # bothering, and it would put the first probe an interval too early for ever
            # after.
            row.last_probe_at = now
            just_opened = True

        should_alert = just_opened or (
            row.circuit_open
            and (row.last_alert_at is None or (now - row.last_alert_at).total_seconds() >= REALERT_AFTER_SECONDS)
        )
        if should_alert:
            row.last_alert_at = now
        row.save()

        if should_alert:
            _alert_open(webhook, row, exc, just_opened=just_opened)
    except Exception as exc2:  # noqa: BLE001 — tracking must never break delivery
        logger.warning("webhook %s: could not record the failure (%s)", getattr(webhook, "id", "?"), exc2)


def record_success(webhook):
    """Reset the streak, and close the breaker if it was open — announcing the recovery.

    Writes nothing in the healthy case. The row only exists once something has failed, so
    a webhook that has never failed costs one SELECT here and no UPDATE.
    """
    try:
        health = _health_model()
        row = health.objects.filter(webhook_id=webhook.id).first()
        if row is None or (not row.circuit_open and not row.consecutive_failures):
            return

        was_open = row.circuit_open
        failures = row.consecutive_failures
        since = row.first_failure_at

        row.circuit_open = False
        row.opened_at = None
        row.consecutive_failures = 0
        row.first_failure_at = None
        row.last_alert_at = None
        row.last_error = ""
        row.save()

        if was_open:
            _alert_recovered(webhook, failures, since)
    except Exception as exc:  # noqa: BLE001
        logger.warning("webhook %s: could not record the success (%s)", getattr(webhook, "id", "?"), exc)


def _alert_open(webhook, row, exc, just_opened):
    """Tell a person, through the route this fork already uses for a dead task run."""
    opened = "is now failing" if just_opened else "is still failing"
    since = row.first_failure_at.isoformat(timespec="seconds") if row.first_failure_at else "unknown"
    note = (
        f"Endpoint {opened} after {row.consecutive_failures} consecutive attempts, "
        f"first failure {since}.\n"
        f"Deliveries are paused and probed every {PROBE_INTERVAL_SECONDS // 60} min; "
        f"the webhook is still ENABLED and resumes by itself when the endpoint answers. "
        f"No action is needed unless this endpoint is gone for good."
    )
    report_task_failure(f"webhook {_describe(webhook)}", exc, note=note)


def _alert_recovered(webhook, failures, since):
    """The other half of the story. Same stream and topic, so the outage reads as one thread."""
    logger.info("webhook %s: endpoint recovered after %s failed attempts", webhook.id, failures)
    try:
        from plane.arribada import zulip_notify

        if not zulip_notify.is_enabled():
            return
        window = f" (failing since {since.isoformat(timespec='seconds')})" if since else ""
        zulip_notify.post_to_stream(
            ALERT_STREAM,
            ALERT_TOPIC,
            f"✅ **webhook {_describe(webhook)}** is answering again after "
            f"{failures} failed attempts{window}. Deliveries have resumed.",
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not report the recovery of webhook %s to chat", webhook.id)
