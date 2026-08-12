# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Every task the schedule names must exist by the time beat says its name.

Celery's `autodiscover_tasks()` only scans `<app>/tasks.py`. Upstream registers
its tasks through `CELERY_IMPORTS`; this fork imports one module per task by hand
in `ArribadaConfig.ready`. Either way a task left out fails in the quietest way
there is: beat sends the name on schedule, no worker has ever heard of it, and
neither side raises. No import breaks, `manage.py check` stays clean, and the
only symptom is a table that never fills.

It has happened twice. `cycle_scope_snapshot` was scheduled and never registered,
so `arribada_cycle_scope_snapshot` held zero rows after beat had fired it. And
`github_plane_sync` spent a day unregistered because a helper was inserted
between `@shared_task` and its `def`, which decorated the helper instead.

Two different mistakes, one symptom, and nothing else in the suite catches
either — because this is not a question about any one module, it is a question
about the schedule and the registry agreeing.

The last two tests are about a different way for a scheduled task to do nothing:
being delivered, running, and writing its answer under the wrong date.

No database: both are in memory.
"""

import inspect
from datetime import datetime, timedelta, timezone as dt_timezone

from plane.arribada.scope_snapshot_task import LATE_TICK_GRACE, _recorded_day
from plane.arribada.task_safety import RETRY_POLICY
from plane.celery import app as celery_app


def _registry():
    """The task registry as a worker has it at boot.

    A worker calls `import_default_modules()` on start, which is what pulls in
    everything named in `CELERY_IMPORTS`. Reading the registry without it would
    only prove that upstream registers its tasks by a different mechanism than
    this fork does, and would report ten upstream tasks as missing when they are
    not. Anything still absent after this really is absent from a running worker.
    """
    celery_app.loader.import_default_modules()
    # Touching `.tasks` finalizes the app, which is what triggers autodiscovery.
    return celery_app.tasks


def _scheduled_task_names():
    return {entry["task"] for entry in celery_app.conf.beat_schedule.values()}


def test_every_scheduled_task_is_registered():
    """The whole point. A name beat can send that celery cannot answer is a job
    that silently never runs."""
    registered = _registry()
    missing = sorted(name for name in _scheduled_task_names() if name not in registered)
    assert missing == [], f"scheduled but never registered: {missing}"


def test_the_forks_own_tasks_are_in_the_schedule():
    """A guard on the guard above: an empty or fork-less schedule would satisfy
    it while nothing this fork adds ever ran."""
    ours = {name for name in _scheduled_task_names() if name.startswith("plane.arribada.")}
    assert len(ours) >= 5, f"the fork's tasks have gone missing from the schedule: {sorted(ours)}"


def test_every_scheduled_task_takes_the_arguments_beat_gives_it():
    """Registered is not quite enough. `@shared_task` sitting on the wrong
    function still registers a name — it just resolves to the wrong body, which
    is exactly how `github_plane_sync` broke. Beat passes nothing, so a scheduled
    task that requires an argument is a scheduled task that raises every time."""
    registry = _registry()
    for name in sorted(_scheduled_task_names()):
        task = registry.get(name)
        assert task is not None, name
        required = [
            parameter.name
            for parameter in inspect.signature(task.run).parameters.values()
            if parameter.default is inspect.Parameter.empty
            and parameter.kind
            in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        ]
        assert required == [], f"{name} needs arguments beat will never pass: {required}"


# --- the snapshot's expiry, which is a date question wearing a queue setting ---
#
# `arribada-cycle-scope-snapshot` is the only entry in the schedule whose OUTPUT
# is keyed on which day it is: one row per cycle per date, and yesterday's row
# cannot be recomputed from anything. That makes its `expire_seconds` load-
# bearing in both directions, and it was wrong in the direction nobody checks.
#
# It fired at 23:50 and expired after an hour — which is 00:50, so the expiry
# accepted fifty minutes of post-midnight delivery. A run that landed there
# stamped its row with the NEW day, and that day's own 23:50 run then overwrote
# it. The day the tick was for ended with no row at all, and the only visible
# symptom was a gap in a chart that is documented to have gaps.
#
# The two tests below are the two edges of the same number, both computed from
# the constants they are protecting rather than restated here, so moving the
# schedule or the grace moves them with it.

SNAPSHOT = "arribada-cycle-scope-snapshot"


def _fires_at(entry, day):
    """The instant this entry's crontab fires on `day`, as an aware datetime."""
    schedule = entry["schedule"]
    # A crontab expands each field into a set; these entries name exactly one.
    return datetime(
        day.year, day.month, day.day,
        min(schedule.hour), min(schedule.minute),
        tzinfo=dt_timezone.utc,
    )


def test_the_snapshot_can_never_be_delivered_after_it_stops_knowing_which_day_it_is():
    """The upper bound. Every delivery the expiry still accepts must record the
    day its tick was fired on — otherwise the run silently spends the next day's
    row on the wrong figures and the day it was sent for is gone for good.

    Dated on the European fall-back Sunday, and read at a moment when a reader
    at UTC+13 is already on the 26th: the arithmetic must not depend on either.
    """
    entry = celery_app.conf.beat_schedule[SNAPSHOT]
    fired = _fires_at(entry, datetime(2026, 10, 25))
    latest_delivery = fired + timedelta(seconds=entry["options"]["expire_seconds"])

    assert _recorded_day(latest_delivery) == fired.date(), (
        f"a delivery accepted at {latest_delivery:%H:%M} would be recorded under "
        f"{_recorded_day(latest_delivery)} rather than {fired.date()} — the expiry outlives "
        f"the {LATE_TICK_GRACE} of grace the task dates itself by"
    )


def test_the_snapshot_expiry_outlives_a_retry_rather_than_dropping_the_day():
    """The lower bound, and the reason "expire before midnight" is not the fix.

    A ten-minute window looks safe and loses the day to the first hiccup:
    RETRY_POLICY backs off by up to `retry_backoff_max` and celery carries the
    original `expires` onto every retry, so an expiry shorter than one backoff
    discards the task's own retry — and a day nobody snapshotted reads exactly
    like a day nothing happened on.
    """
    expiry = celery_app.conf.beat_schedule[SNAPSHOT]["options"]["expire_seconds"]
    assert expiry >= RETRY_POLICY["retry_backoff_max"], (
        f"{expiry}s is shorter than the {RETRY_POLICY['retry_backoff_max']}s this task can "
        "wait before its own retry, so the retry would be discarded on arrival"
    )
