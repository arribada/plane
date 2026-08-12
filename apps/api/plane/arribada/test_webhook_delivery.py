# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Webhook delivery: the four ways it reported success while failing, and the policy that replaced them.

THE SUBJECT OF THIS FILE IS SILENCE. Every defect asserted here was a failure that
looked like a success from the outside, which is why none of them had a test and why the
Plane↔wiki sync would have died months from now with nobody able to say when.

* A work item deleted in Plane emitted no webhook at all — only project deletion did — so
  a subscriber heard about an item's creation and every edit and was never told it had
  gone. There was nothing to observe: the delete returned 204 and the in-app activity feed
  was correct.
* A non-2xx response was recorded as a delivered event. `requests` returns a 500 like any
  other response, and nothing called `raise_for_status`, so a receiver that was completely
  broken was indistinguishable in the logs from one that was fine, and the event was never
  retried.
* `X-Plane-Delivery` was a fresh uuid4 on every attempt, so a receiver had nothing to
  deduplicate on. Harmless while nothing retried; the moment the fix above made retries
  real, it became "apply the same edit six times".
* One delivery exhausting its retries set `is_active = False` and emailed the creator. An
  hour of the wiki being down ended the integration permanently.

THE TESTS ARE WRITTEN BOTH WAYS wherever the assertion is a negative. "The breaker did not
open" passes just as well on a breaker that can never open, and "the secret is absent"
passes on a serializer that returns nothing at all — so each of those is paired with the
case that must still work. That pairing is the point of several of these files and it is
the reason the money pass found nine defects under a green suite.

WHAT IS DELIBERATELY NOT ASSERTED: the exact backoff intervals and the retry ceiling. They
are upstream's, they are unchanged, and pinning them here would turn an upstream tuning
change into a red build in our fork for no benefit. What is pinned is that the ceiling is
still CONSULTED — that an exhausted delivery stops rather than retrying for ever.

Needs a database.
"""

import json
from datetime import timedelta
from unittest import mock

import pytest
import requests
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada import webhook_health
from plane.arribada.models import WebhookDeliveryHealth
from plane.bgtasks.webhook_task import webhook_send_task
from plane.db.models import Issue, Project, ProjectMember, State, User, Webhook, Workspace, WorkspaceMember


class RetryRequested(Exception):
    """Sentinel standing in for Celery's scheduling of the next attempt.

    `webhook_send_task` declares `autoretry_for=(requests.RequestException,)`, so a
    failure leaves the task body by being raised and Celery's wrapper turns it into
    `task.retry(...)`. Replacing `retry` with something that raises this makes "it asked
    to be retried" a fact the test can read, instead of a scheduling side effect that
    eager mode models only approximately.
    """


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    """CI has Postgres and no RabbitMQ; the delete handlers publish on the success path.

    Without this a `.delay()` on the way out of a 204 becomes a broker timeout and then a
    500, and an assertion written as "the webhook fired" would fail for a reason that has
    nothing to do with webhooks.
    """
    from celery.app.task import Task

    monkeypatch.setattr(Task, "apply_async", lambda self, *a, **k: None)


@pytest.fixture(autouse=True)
def no_dns(monkeypatch):
    """`validate_url` resolves the hostname to check it is not an internal address.

    Left alone it makes a real DNS query for every delivery in this file, which is slow,
    depends on the network and fails closed — every test would fall into the task's
    catch-all and pass by not reaching its subject. It is patched OUT rather than pointed
    at something harmless because SSRF re-validation is not what this file is about; that
    it still happens at send time is asserted once, separately, below.
    """
    monkeypatch.setattr("plane.bgtasks.webhook_task.validate_url", lambda *a, **k: None)


@pytest.fixture
def hooked(db):
    """A workspace with a work item and a webhook subscribed to work-item events."""
    owner = User.objects.create(email="wh-owner@arribada.test", username="wh-owner")
    workspace = Workspace.objects.create(name="Hooked", owner=owner, slug="hooked-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(name="Synced", workspace=workspace, created_by=owner, identifier="SYN")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    state = State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    issue = Issue.objects.create(
        name="A tracked thing", project=project, workspace=workspace, state=state, created_by=owner
    )
    webhook = Webhook.objects.create(
        workspace=workspace,
        url="https://docs.arribada.test/plane-hook",
        issue=True,
        project=True,
        created_by=owner,
    )

    client = APIClient()
    client.force_authenticate(user=owner)

    return {
        "workspace": workspace,
        "slug": workspace.slug,
        "project": project,
        "project_id": str(project.id),
        "issue": issue,
        "webhook": webhook,
        "owner": owner,
        "client": client,
    }


# --------------------------------------------------------------- running one delivery


def _response(status_code, body="ok"):
    """A `requests.Response` that behaves like a real one, `raise_for_status` included."""
    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode("utf-8")
    response.url = "https://docs.arribada.test/plane-hook"
    response.headers["Content-Type"] = "text/plain"
    return response


def _deliver(hooked, *, status_code=200, exc=None, task_id="delivery-1", retries=0):
    """Run one attempt of `webhook_send_task` synchronously and report what it decided.

    Returns `(outcome, post_mock, log_mock)` where outcome is "sent", "retried" or
    "gave-up" — the three things the task can do with an attempt, and the distinction the
    whole file turns on.
    """
    post = mock.Mock(side_effect=exc) if exc else mock.Mock(return_value=_response(status_code))
    log = mock.Mock()
    kwargs = {
        "webhook_id": str(hooked["webhook"].id),
        "slug": hooked["slug"],
        "event": "issue",
        "event_data": {"id": str(hooked["issue"].id)},
        "action": "POST",
        "current_site": "https://plane.arribada.test",
        "activity": None,
    }
    with (
        mock.patch("plane.bgtasks.webhook_task.requests.post", post),
        mock.patch("plane.bgtasks.webhook_task.save_webhook_log", log),
        mock.patch.object(webhook_send_task, "retry", side_effect=RetryRequested()),
    ):
        result = webhook_send_task.apply(kwargs=kwargs, task_id=task_id, retries=retries, throw=False)

    if isinstance(result.result, RetryRequested):
        return "retried", post, log
    if result.state != "SUCCESS":  # pragma: no cover — an escaped exception is a broken test
        raise AssertionError(f"delivery raised {result.result!r}")

    # The task returned. Either it delivered, or it hit the retry ceiling and stopped —
    # told apart by the status it recorded, since only a real send logs a 2xx.
    logged = str(log.call_args.kwargs["response_status"]) if log.called else None
    return ("sent" if logged in ("200", "201", "202", "204") else "gave-up"), post, log


def _health(hooked):
    return WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).first()


# ============================================================ 1. issue.deleted is emitted


@pytest.mark.django_db
def test_deleting_a_work_item_through_the_v1_api_emits_a_delete_webhook(hooked):
    """The gap that leaves the wiki holding a page for something that no longer exists."""
    url = f"/api/v1/workspaces/{hooked['slug']}/projects/{hooked['project_id']}/work-items/{hooked['issue'].id}/"
    with mock.patch("plane.api.views.issue.webhook_activity") as emitted:
        response = hooked["client"].delete(url)

    assert response.status_code == 204
    assert emitted.delay.called, "a deleted work item emitted no webhook"
    sent = emitted.delay.call_args.kwargs
    assert sent["event"] == "issue"
    assert sent["verb"] == "deleted"
    assert str(sent["event_id"]) == str(hooked["issue"].id)
    assert sent["slug"] == hooked["slug"]


@pytest.mark.django_db
def test_deleting_a_work_item_through_the_app_emits_a_delete_webhook(hooked):
    """The path a person clicking Delete actually takes — most deletions come through here."""
    url = f"/api/workspaces/{hooked['slug']}/projects/{hooked['project_id']}/issues/{hooked['issue'].id}/"
    with mock.patch("plane.app.views.issue.base.webhook_activity") as emitted:
        response = hooked["client"].delete(url)

    assert response.status_code == 204
    assert emitted.delay.called, "a deleted work item emitted no webhook"
    sent = emitted.delay.call_args.kwargs
    assert sent["event"] == "issue"
    assert sent["verb"] == "deleted"
    assert str(sent["event_id"]) == str(hooked["issue"].id)


@pytest.mark.django_db
def test_a_deleted_work_item_still_records_its_in_app_activity(hooked):
    """The other way round: the webhook is an ADDITION, not a replacement.

    Without this, dropping the `issue_activity` call while adding the webhook would leave
    the test above green and silently empty the activity feed.
    """
    url = f"/api/workspaces/{hooked['slug']}/projects/{hooked['project_id']}/issues/{hooked['issue'].id}/"
    with mock.patch("plane.app.views.issue.base.issue_activity") as activity:
        response = hooked["client"].delete(url)

    assert response.status_code == 204
    assert activity.delay.called
    assert activity.delay.call_args.kwargs["type"] == "issue.activity.deleted"


@pytest.mark.django_db
def test_the_delete_payload_carries_only_the_id(hooked):
    """Pins the shape the receiver has to cope with, because the row is already gone.

    `webhook_activity` cannot serialise a deleted object, so `data` is `{"id": ...}` and
    nothing else — no project, no identifier, no external_id. Any consumer therefore needs
    its OWN map from Plane id to its page. This is asserted rather than assumed because it
    is the single most likely thing for the wiki side to get wrong.
    """
    from plane.bgtasks.webhook_task import webhook_activity

    with mock.patch("plane.bgtasks.webhook_task.webhook_send_task") as send:
        webhook_activity(
            event="issue",
            verb="deleted",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=str(hooked["owner"].id),
            slug=hooked["slug"],
            current_site="https://plane.arribada.test",
            event_id=str(hooked["issue"].id),
            old_identifier=None,
            new_identifier=None,
        )

    assert send.delay.called, "no active webhook was matched for a work-item delete"
    assert send.delay.call_args.kwargs["event_data"] == {"id": str(hooked["issue"].id)}
    assert send.delay.call_args.kwargs["action"] == "deleted"


# =========================================================== 2. a non-2xx is not a delivery


@pytest.mark.django_db
def test_a_500_from_the_receiver_is_retried_not_counted_as_delivered(hooked):
    outcome, post, _ = _deliver(hooked, status_code=500)
    assert post.called
    assert outcome == "retried", "a 500 from the receiver was accepted as a successful delivery"


@pytest.mark.django_db
@pytest.mark.parametrize("status_code", [400, 401, 403, 404, 429, 500, 502, 503])
def test_every_error_status_is_a_failed_delivery(hooked, status_code):
    outcome, _, _ = _deliver(hooked, status_code=status_code)
    assert outcome == "retried"


@pytest.mark.django_db
@pytest.mark.parametrize("status_code", [200, 201, 202, 204])
def test_every_success_status_is_a_delivery(hooked, status_code):
    """The other way round. Without this, "everything is a failure" would pass the test above."""
    outcome, _, _ = _deliver(hooked, status_code=status_code)
    assert outcome == "sent"


@pytest.mark.django_db
def test_a_failed_delivery_is_logged_with_the_receivers_real_status(hooked):
    """A person reading the webhook log must be able to tell a 404 from a dropped connection."""
    _, _, log = _deliver(hooked, status_code=503)
    assert log.called
    logged = log.call_args.kwargs
    assert str(logged["response_status"]) == "503"
    assert "ok" in str(logged["response_body"])


@pytest.mark.django_db
def test_a_transport_error_is_still_logged_as_500(hooked):
    """The pre-existing behaviour for the case where there is no response to read."""
    _, _, log = _deliver(hooked, exc=requests.ConnectionError("connection refused"))
    assert log.called
    logged = log.call_args.kwargs
    assert str(logged["response_status"]) == "500"
    assert "connection refused" in str(logged["response_body"])


@pytest.mark.django_db
def test_one_attempt_writes_exactly_one_log_row(hooked):
    """Raising before the log rather than after it must not produce two rows, or none."""
    _, _, log = _deliver(hooked, status_code=500)
    assert log.call_count == 1
    _, _, log_ok = _deliver(hooked, status_code=200)
    assert log_ok.call_count == 1


@pytest.mark.django_db
def test_the_url_is_still_revalidated_at_send_time(hooked, monkeypatch):
    """The SSRF guard is load-bearing and sits next to everything this file changed."""
    checked = mock.Mock()
    monkeypatch.setattr("plane.bgtasks.webhook_task.validate_url", checked)
    _deliver(hooked, status_code=200)
    assert checked.called, "the send-time DNS-rebinding check stopped running"


# ============================================================= 3. a stable delivery id


@pytest.mark.django_db
def test_the_delivery_id_is_stable_across_retries(hooked):
    """Same delivery, second attempt: the receiver must see the same id or it cannot dedupe."""
    _, first, _ = _deliver(hooked, status_code=200, task_id="delivery-abc", retries=0)
    _, second, _ = _deliver(hooked, status_code=200, task_id="delivery-abc", retries=1)

    first_id = first.call_args.kwargs["headers"]["X-Plane-Delivery"]
    second_id = second.call_args.kwargs["headers"]["X-Plane-Delivery"]
    assert first_id == second_id == "delivery-abc"


@pytest.mark.django_db
def test_two_different_deliveries_get_two_different_ids(hooked):
    """The other way round: a constant id would make the receiver drop distinct events."""
    _, one, _ = _deliver(hooked, status_code=200, task_id="delivery-1")
    _, two, _ = _deliver(hooked, status_code=200, task_id="delivery-2")

    assert (
        one.call_args.kwargs["headers"]["X-Plane-Delivery"]
        != two.call_args.kwargs["headers"]["X-Plane-Delivery"]
    )


@pytest.mark.django_db
def test_the_signature_still_covers_the_payload(hooked):
    """Changing the headers must not have disturbed the HMAC the receiver verifies."""
    import hashlib
    import hmac

    _, post, _ = _deliver(hooked, status_code=200)
    sent = post.call_args.kwargs
    expected = hmac.new(
        hooked["webhook"].secret_key.encode("utf-8"),
        json.dumps(sent["json"]).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert sent["headers"]["X-Plane-Signature"] == expected


# ==================================================== 4. sustained failure, not deactivation


@pytest.mark.django_db
def test_an_exhausted_delivery_does_not_deactivate_the_webhook(hooked):
    """THE regression test. One bad hour used to end the integration for good.

    A DROPPED CONNECTION, not a 500, and the difference is the whole reason this test is
    worth reading. The old code only ever reached its deactivation branch from a transport
    error, because a 500 did not raise and was filed as a successful send — so a version of
    this test written with a 500 passes against the broken code by never reaching the bug.
    This is what an unreachable wiki actually looks like from here.
    """
    for attempt in range(webhook_send_task.max_retries + 1):
        _deliver(hooked, exc=requests.ConnectionError("connection refused"), task_id="doomed", retries=attempt)

    hooked["webhook"].refresh_from_db()
    assert hooked["webhook"].is_active is True, "an unreachable endpoint deactivated the webhook"


@pytest.mark.django_db
def test_an_exhausted_delivery_stops_retrying(hooked):
    """The other way round: not deactivating must not become retrying for ever.

    The retry ceiling is upstream's and unchanged; what is pinned here is that it is still
    consulted, because "never deactivate" is only affordable while this bound holds.
    """
    outcome, _, _ = _deliver(
        hooked, exc=requests.ConnectionError("connection refused"), retries=webhook_send_task.max_retries
    )
    assert outcome == "gave-up"


@pytest.mark.django_db
def test_no_deactivation_email_is_sent(hooked):
    """The mail said "has been deactivated", which would now be untrue for every case."""
    with mock.patch("plane.bgtasks.webhook_task.send_webhook_deactivation_email") as email:
        for attempt in range(webhook_send_task.max_retries + 1):
            _deliver(
                hooked, exc=requests.ConnectionError("connection refused"), task_id="doomed", retries=attempt
            )
    assert not email.delay.called


@pytest.mark.django_db
def test_the_breaker_stays_closed_below_the_threshold(hooked):
    for _ in range(webhook_health.OPEN_AFTER_FAILURES - 1):
        _deliver(hooked, status_code=500)

    health = _health(hooked)
    assert health.consecutive_failures == webhook_health.OPEN_AFTER_FAILURES - 1
    assert health.circuit_open is False, "a brief outage opened the breaker"


@pytest.mark.django_db
def test_sustained_failure_opens_the_breaker(hooked):
    """The other way round: a breaker that never opens would pass the test above."""
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)

    health = _health(hooked)
    assert health.circuit_open is True
    assert health.first_failure_at is not None
    assert "500" in health.last_error


@pytest.mark.django_db
def test_one_success_clears_the_streak(hooked):
    """A single poisoned event cannot open the breaker, because everything else still lands.

    Four failures, one success, four more failures: eight failures in total, never five in
    a row, and the endpoint is demonstrably working — so the breaker must stay closed.
    """
    for _ in range(webhook_health.OPEN_AFTER_FAILURES - 1):
        _deliver(hooked, status_code=500)
    _deliver(hooked, status_code=200)
    for _ in range(webhook_health.OPEN_AFTER_FAILURES - 1):
        _deliver(hooked, status_code=500)

    health = _health(hooked)
    assert health.circuit_open is False
    assert health.consecutive_failures == webhook_health.OPEN_AFTER_FAILURES - 1


@pytest.mark.django_db
def test_an_open_breaker_makes_no_request(hooked):
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)

    outcome, post, log = _deliver(hooked, status_code=500)
    assert not post.called, "a known-dead endpoint was hit anyway"
    assert not log.called, "a deferred attempt was logged as a delivery attempt"
    assert outcome == "retried", "a deferred event was dropped instead of waiting"


@pytest.mark.django_db
def test_a_deferred_attempt_does_not_inflate_the_counter(hooked):
    """Deferring is not new evidence about the endpoint, and must not read as more failure.

    A failed PROBE does count — it is a real request that really failed — which is why
    this asserts over the deliveries inside one probe interval, where no request is made
    at all.
    """
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)
    before = _health(hooked).consecutive_failures

    for _ in range(5):
        _deliver(hooked, status_code=500)

    assert _health(hooked).consecutive_failures == before


@pytest.mark.django_db
def test_opening_the_breaker_does_not_immediately_probe(hooked):
    """The attempt that opened it IS the recent evidence; asking again at once is a wasted request."""
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)

    health = _health(hooked)
    assert health.circuit_open is True
    assert health.last_probe_at is not None, "the probe clock must start when the breaker opens"


@pytest.mark.django_db
def test_one_probe_is_allowed_through_per_interval(hooked):
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)

    WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).update(last_probe_at=None)
    _, first, _ = _deliver(hooked, status_code=500)
    _, second, _ = _deliver(hooked, status_code=500)

    assert first.called, "the breaker never probes, so it can never close"
    assert not second.called, "every delivery probed, which is not a breaker at all"


@pytest.mark.django_db
def test_a_probe_is_allowed_again_after_the_interval(hooked):
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)

    stale = timezone.now() - timedelta(seconds=webhook_health.PROBE_INTERVAL_SECONDS + 60)
    WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).update(last_probe_at=stale)

    _, post, _ = _deliver(hooked, status_code=500)
    assert post.called


@pytest.mark.django_db
def test_a_successful_probe_re_arms_the_integration_with_no_human(hooked):
    """The whole reason not to deactivate: recovery has to happen by itself."""
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)
    assert _health(hooked).circuit_open is True

    WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).update(last_probe_at=None)
    outcome, _, _ = _deliver(hooked, status_code=200)

    assert outcome == "sent"
    health = _health(hooked)
    assert health.circuit_open is False
    assert health.consecutive_failures == 0

    # And the next ordinary delivery goes straight out.
    _, post, _ = _deliver(hooked, status_code=200)
    assert post.called


@pytest.mark.django_db
def test_opening_the_breaker_tells_a_human(hooked):
    """An email to the creator is what this replaced, and nobody read it."""
    with mock.patch("plane.arribada.webhook_health.report_task_failure") as told:
        for _ in range(webhook_health.OPEN_AFTER_FAILURES):
            _deliver(hooked, status_code=500)

    assert told.called, "the breaker opened without telling anybody"
    note = told.call_args.kwargs["note"]
    assert "still ENABLED" in note, "the alert must not read as a deactivation"
    assert hooked["webhook"].url in told.call_args.args[0]


@pytest.mark.django_db
def test_the_alert_is_sent_once_not_on_every_attempt(hooked):
    """A channel that repeats itself gets muted, and a muted alert is the silence we removed."""
    with mock.patch("plane.arribada.webhook_health.report_task_failure") as told:
        for _ in range(webhook_health.OPEN_AFTER_FAILURES + 20):
            _deliver(hooked, status_code=500)
    assert told.call_count == 1


@pytest.mark.django_db
def test_a_long_outage_re_announces_itself(hooked):
    """The message that opened the breaker may have arrived at 03:00."""
    with mock.patch("plane.arribada.webhook_health.report_task_failure") as told:
        for _ in range(webhook_health.OPEN_AFTER_FAILURES):
            _deliver(hooked, status_code=500)

        long_ago = timezone.now() - timedelta(seconds=webhook_health.REALERT_AFTER_SECONDS + 60)
        WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).update(
            last_alert_at=long_ago, last_probe_at=None
        )
        _deliver(hooked, status_code=500)

    assert told.call_count == 2
    assert "still failing" in told.call_args.kwargs["note"]


@pytest.mark.django_db
def test_recovery_is_announced_too(hooked):
    """Half a story in the alerts channel is how an incident stays open in people's heads."""
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)
    WebhookDeliveryHealth.objects.filter(webhook_id=hooked["webhook"].id).update(last_probe_at=None)

    with (
        mock.patch("plane.arribada.zulip_notify.is_enabled", return_value=True),
        mock.patch("plane.arribada.zulip_notify.post_to_stream") as posted,
    ):
        _deliver(hooked, status_code=200)

    assert posted.called
    stream, topic, body = posted.call_args.args
    assert stream == webhook_health.ALERT_STREAM
    assert topic == webhook_health.ALERT_TOPIC
    assert "answering again" in body


@pytest.mark.django_db
def test_a_healthy_endpoint_is_never_announced(hooked):
    """The other way round: alerting on success would be the same noise problem."""
    with (
        mock.patch("plane.arribada.webhook_health.report_task_failure") as told,
        mock.patch("plane.arribada.zulip_notify.is_enabled", return_value=True),
        mock.patch("plane.arribada.zulip_notify.post_to_stream") as posted,
    ):
        for _ in range(10):
            _deliver(hooked, status_code=200)

    assert not told.called
    assert not posted.called


@pytest.mark.django_db
def test_a_healthy_endpoint_writes_no_health_row(hooked):
    """This sits on the path of every webhook the instance sends; it must cost nothing."""
    for _ in range(5):
        _deliver(hooked, status_code=200)
    assert _health(hooked) is None


@pytest.mark.django_db
def test_a_broken_health_table_does_not_stop_delivery(hooked):
    """Fails OPEN, like `task_lock` on an unreachable Redis: the guard is worth less than the event."""
    with mock.patch(
        "plane.arribada.webhook_health._health_model", side_effect=RuntimeError("no table")
    ):
        outcome, post, _ = _deliver(hooked, status_code=200)

    assert post.called
    assert outcome == "sent"


@pytest.mark.django_db
def test_deleting_a_webhook_takes_its_health_row_with_it(hooked):
    """`delete(soft=False)` because upstream's `BaseModel` soft-deletes by default.

    A soft delete leaves the row and its FK intact, which is correct — the webhook is
    recoverable and so is what we know about it. The CASCADE this asserts is the one that
    stops the health table outliving the table it describes.
    """
    for _ in range(webhook_health.OPEN_AFTER_FAILURES):
        _deliver(hooked, status_code=500)
    assert _health(hooked) is not None

    Webhook.objects.filter(pk=hooked["webhook"].id).delete(soft=False)
    assert _health(hooked) is None


# ================================================================= the secret key leak


@pytest.mark.django_db
def test_the_webhook_list_does_not_leak_the_secret_key(hooked):
    """`fields=` excluded it and `DynamicBaseSerializer` threw the allowlist away."""
    response = hooked["client"].get(f"/api/workspaces/{hooked['slug']}/webhooks/")
    assert response.status_code == 200
    assert response.json(), "no webhook returned, so this asserts nothing"
    for row in response.json():
        assert "secret_key" not in row


@pytest.mark.django_db
def test_the_webhook_detail_does_not_leak_the_secret_key(hooked):
    url = f"/api/workspaces/{hooked['slug']}/webhooks/{hooked['webhook'].id}/"
    response = hooked["client"].get(url)
    assert response.status_code == 200
    assert "secret_key" not in response.json()
    # Still a usable payload, not an empty one.
    assert response.json()["url"] == hooked["webhook"].url


@pytest.mark.django_db
def test_updating_a_webhook_does_not_leak_the_secret_key(hooked):
    url = f"/api/workspaces/{hooked['slug']}/webhooks/{hooked['webhook'].id}/"
    response = hooked["client"].patch(url, data={"is_active": True}, format="json")
    assert response.status_code == 200
    assert "secret_key" not in response.json()


@pytest.mark.django_db
def test_creating_a_webhook_still_returns_the_secret_key(hooked):
    """The other way round, and it matters: this is the ONE time the key is shown.

    A fix that simply stripped the field everywhere would leave an admin unable to
    configure the receiver, which is a worse failure than the leak.
    """
    with mock.patch("plane.app.serializers.webhook.validate_url", lambda *a, **k: None):
        response = hooked["client"].post(
            f"/api/workspaces/{hooked['slug']}/webhooks/",
            data={"url": "https://docs.arribada.test/second-hook", "issue": True},
            format="json",
        )
    assert response.status_code == 201
    assert response.json().get("secret_key"), "the create response must hand the secret over once"
