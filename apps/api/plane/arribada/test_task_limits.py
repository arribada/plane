# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The two halves of "a scheduled task may not run twice".

Half one is a ceiling. RabbitMQ's `consumer_timeout` defaults to thirty minutes and
this deployment ships no `rabbitmq.conf`, so thirty minutes is what production runs.
A consumer that holds a delivery unacknowledged past it has its CHANNEL closed and
the still-executing delivery requeued — which, on tasks configured with
`acks_late=True` and `reject_on_worker_lost=True`, means the same task running
twice at once. There was no `time_limit` or `soft_time_limit` anywhere in the
settings when `acks_late` shipped.

`expire_seconds` does not cover it: expiry only discards a message that is still
QUEUED, and only where it is shorter than thirty minutes. The three tasks whose
expiry is LONGER — `cycle_scope_snapshot` (60 min), `due_date_reminder` (4 h),
`github_classification_warnings` (4 h) — are exactly the three that take no lock,
and two of those are check-then-act on `Notification` with no unique index behind
them. A second concurrent run is duplicate notifications and duplicate Zulip pings
landing on real people.

Half two is the lock's fencing token. The release is in a `finally`, which a
SIGKILL never runs, so a killed worker leaves the key behind for its whole TTL. The
`acks_late` redelivery then failed `SET NX` against that orphan and returned
"another run is already in progress" — so `acks_late` delivered ZERO crash recovery
for precisely the two tasks that take a lock. Passing the Celery delivery's
`task_id` as the lock's value fixes it: a redelivery is the same message with the
same id, so it can recognise its own dead predecessor's lock and take it over,
while any other run still stands down.

Run explicitly: `python -m pytest plane/arribada/test_task_limits.py`
"""

import pytest
from django.conf import settings

from plane.arribada import task_safety
from plane.arribada.task_safety import task_lock

# RabbitMQ's shipped default, in seconds — 1_800_000 ms. Asserted against the literal as
# well as against the setting, because the setting is only a note about the broker: nothing
# in this repository can change what RabbitMQ does, and a test that read the number from the
# same place the code reads it would pass on a deployment where somebody had "fixed" the
# mismatch by editing the note.
RABBITMQ_CONSUMER_TIMEOUT = 30 * 60


def test_the_documented_broker_timeout_is_the_one_rabbitmq_actually_ships():
    assert settings.RABBITMQ_CONSUMER_TIMEOUT_SECONDS == RABBITMQ_CONSUMER_TIMEOUT


# --- half one: the ceiling ---------------------------------------------------


def test_a_task_is_killed_before_rabbitmq_gives_up_on_its_delivery():
    """The whole point. Both limits must sit under `consumer_timeout`, or the
    broker requeues a delivery whose task is still running and `acks_late` turns
    one slow run into two concurrent ones."""
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < RABBITMQ_CONSUMER_TIMEOUT
    assert settings.CELERY_TASK_TIME_LIMIT < RABBITMQ_CONSUMER_TIMEOUT


def test_the_soft_limit_comes_first_and_leaves_room_to_unwind():
    """Soft raises SoftTimeLimitExceeded inside the task so its `finally` blocks run
    — which is what releases a `task_lock`. Hard kills the child outright. Soft
    landing on or after hard would mean the lock is never released cleanly."""
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT
    # A minute is enough for a `finally` and an ack, and small enough that the hard
    # limit is still comfortably under the broker's patience.
    assert settings.CELERY_TASK_TIME_LIMIT - settings.CELERY_TASK_SOFT_TIME_LIMIT >= 60


def test_the_limits_reach_celery_and_are_not_just_module_constants():
    """Celery reads these through `config_from_object("django.conf:settings",
    namespace="CELERY")`. A setting spelled right in the wrong place is the same
    class of bug as `expires` vs `expire_seconds` in celery.py — correct-looking and
    silently discarded."""
    from plane.celery import app

    assert app.conf.task_soft_time_limit == settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert app.conf.task_time_limit == settings.CELERY_TASK_TIME_LIMIT


def test_every_locked_task_can_finish_inside_its_own_lock():
    """A lock TTL shorter than the longest possible run would let a second delivery
    take the lock while the first is still working. The hard limit is the longest a
    run can be, so no TTL may be exceeded by it without that being deliberate."""
    from plane.arribada.github_sync_task import SYNC_LOCK_SECONDS

    # 25 min lock, 28 min hard kill: the task is killed 3 minutes after its own lock
    # would lapse. That gap is bounded and acceptable — see the note in task_safety
    # — but it must never GROW, because at some width the successor's run overlaps a
    # predecessor that is still writing.
    assert settings.CELERY_TASK_TIME_LIMIT - SYNC_LOCK_SECONDS <= 5 * 60


# --- half two: the fencing token --------------------------------------------


class FakeRedis:
    """Enough of redis-py for `SET NX PX`, `GET` and the compare-and-delete script.

    No TTL clock: every test here is about who holds the key, never about when it
    lapses, and a fake that expired on wall-clock time would make these tests
    time-dependent for nothing.
    """

    def __init__(self):
        self.store = {}

    def set(self, key, value, nx=False, px=None):  # noqa: ARG002 — px is the TTL we ignore
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def get(self, key):
        # Bytes, like the real client with decode_responses off — the caller has to
        # decode, and a test with a str-returning fake would not prove that it does.
        value = self.store.get(key)
        return value.encode() if isinstance(value, str) else value

    def eval(self, _script, _numkeys, key, token):
        if self.store.get(key) == token:
            del self.store[key]
            return 1
        return 0


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr("plane.settings.redis.redis_instance", lambda: client)
    return client


def test_an_ordinary_second_run_still_stands_down(fake_redis):
    """The lock's original job, which none of the below may break."""
    with task_lock("t", 60, owner="delivery-a") as first:
        assert first is True
        with task_lock("t", 60, owner="delivery-b") as second:
            assert second is False


def test_a_redelivery_reclaims_the_lock_its_own_killed_run_left_behind(fake_redis):
    """The crash `acks_late` exists for.

    The first run is killed, so its `finally` never runs and the key survives with
    its task id in it. RabbitMQ redelivers the same message — same task id — and
    before the fencing token that redelivery was refused by its own corpse, making
    `acks_late` worth nothing for this task.
    """
    # A run that died without releasing: write the key exactly as `task_lock` does
    # and never come back.
    fake_redis.store["arribada:lock:github_plane_sync"] = "delivery-42"

    with task_lock("github_plane_sync", 60, owner="delivery-42") as held:
        assert held is True, "the redelivery of task_id delivery-42 must reclaim its own orphaned lock"


def test_reclaiming_is_not_a_way_around_the_lock_for_anybody_else(fake_redis):
    """The takeover is identity-scoped. A test proving only the reclaim above would
    also pass on a lock that had simply stopped locking."""
    fake_redis.store["arribada:lock:github_plane_sync"] = "delivery-42"

    with task_lock("github_plane_sync", 60, owner="delivery-99") as held:
        assert held is False


def test_an_unowned_call_never_reclaims_anything(fake_redis):
    """`.run()` from the Sync-now button passes no task id, so `owner` is None and
    the token is random. Nothing crashed, so there is nothing to take over — and a
    random token must never be able to match its way into somebody else's lock."""
    fake_redis.store["arribada:lock:github_plane_sync"] = "delivery-42"

    with task_lock("github_plane_sync", 60) as held:
        assert held is False


def test_a_reclaimed_lock_is_still_released_on_the_way_out(fake_redis):
    """Otherwise one crash would leave the key held for as long as the task keeps
    being redelivered, which is the original bug wearing a different hat."""
    fake_redis.store["arribada:lock:x"] = "delivery-7"

    with task_lock("x", 60, owner="delivery-7") as held:
        assert held is True
    assert "arribada:lock:x" not in fake_redis.store


def test_a_run_that_lost_its_lock_by_ttl_does_not_delete_its_successor_s(fake_redis):
    """Pre-existing guarantee, re-pinned because the release path was touched: the
    compare-and-delete must still refuse to free a key somebody else now owns."""
    with task_lock("x", 60, owner="delivery-a") as held:
        assert held is True
        # The TTL lapses and a genuinely different delivery takes the key.
        fake_redis.store["arribada:lock:x"] = "delivery-b"
    assert fake_redis.store["arribada:lock:x"] == "delivery-b"


def test_redis_being_unreachable_still_runs_the_task(monkeypatch):
    """Unchanged judgement, pinned because the failed-acquire branch grew a second
    Redis call: losing the lock costs a possible duplicate, refusing to run costs
    the day's data."""

    def explode():
        raise RuntimeError("no redis")

    monkeypatch.setattr("plane.settings.redis.redis_instance", explode)
    with task_lock("x", 60, owner="delivery-a") as held:
        assert held is True


def test_the_two_locked_tasks_pass_their_delivery_id_as_the_owner():
    """The fix is only real if the callers use it. Read off the source of the two
    task bodies rather than by running them, because running `github_plane_sync`
    means a broker, a PAT and the whole GitHub API."""
    import inspect

    from plane.arribada import github_sync_task, notify_forward

    for module, name in ((github_sync_task, "github_plane_sync"), (notify_forward, "forward_notifications")):
        source = inspect.getsource(getattr(module, name).run)
        assert "owner=self.request.id" in source, f"{name} takes its lock without a fencing token"


def test_task_lock_still_works_without_an_owner_at_all():
    """`task_lock` is a general helper and the argument is optional. A caller that
    passes nothing must get the pre-existing behaviour, not a crash."""
    import inspect

    signature = inspect.signature(task_safety.task_lock.__wrapped__)
    assert signature.parameters["owner"].default is None
