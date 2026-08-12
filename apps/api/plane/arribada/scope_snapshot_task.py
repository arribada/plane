# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Record what each running cycle holds, once a day.

The burndown recomputes every past point from the cycle's CURRENT total, so
adding ten items lifts the whole history by ten and the past changes shape
retroactively. A cycle that held 10 items throughout and one that grew from 5 to
20 draw identically — scope creep, the single most useful thing a burndown can
show, is the one thing it hides.

Nothing in the schema remembers what a cycle held on a past day, so the figure has
to be recorded on the day. This writes one small row per running cycle per night.

History before the first run stays wrong and cannot be invented. The chart says
so rather than drawing a line through days it has no figure for.

Two things in here are about the difference between a DAY and an INSTANT, which
is the distinction this whole area keeps losing:

* a cycle's stored start and end are INSTANTS and a day is a range, so the
  question "is this cycle running today" is an overlap, not a comparison — see
  the filter below, which used to answer it with `<=` against one point in time
  and therefore never saw a cycle's first day;
* the day a run RECORDS is the day its tick was fired on, which is not always the
  day the worker happens to wake up on — see `_recorded_day`.
"""

from datetime import datetime, time, timedelta

from celery import shared_task

from plane.arribada.task_safety import BASE, RETRY_POLICY
from plane.db.models import Cycle, Issue
from plane.utils.exception_logger import log_exception

# How late a delivery can be and still be recording the day its tick was fired on.
#
# Beat fires this at 23:50, ten minutes before the day it is recording ends
# (plane/celery.py), and the row is keyed on a date. A run that reads the clock
# and calls it "today" therefore gets the wrong answer for every delivery that
# lands after midnight — and the damage is not one odd row, it is a LOST DAY:
# the row goes in under tomorrow's date, and tomorrow's own 23:50 run overwrites
# it with tomorrow's figures. The day the tick was for ends with no row at all,
# permanently, because nothing in the schema can reconstruct what a cycle held
# yesterday.
#
# That delivery is not hypothetical. `RETRY_POLICY` retries with up to fifteen
# minutes of backoff, and `acks_late` + `reject_on_worker_lost` redeliver the
# whole message after a worker is killed mid-run — a `docker compose up -d` at
# 23:51 is enough.
#
# An hour of slack is safe because nothing else fires this task: the only way to
# be running between 00:00 and 01:00 is to be a late delivery of the previous
# day's tick. The beat entry's `expire_seconds` is sized to stay inside this
# window, and `test_beat_schedule.py` pins the two together — the expiry may
# never accept a delivery this task can no longer date correctly.
LATE_TICK_GRACE = timedelta(hours=1)


def _recorded_day(now):
    """The day a run starting at `now` is RECORDING, which is not always its own.

    Separate from the task body because it is the one decision in here worth
    testing without a database, and because "which day is this row" is a
    decision rather than an expression. A person running the task by hand at any
    ordinary hour still gets the day they are standing in.
    """
    return (now - LATE_TICK_GRACE).date()


def _midnight(day):
    """The instant `day` begins, as an aware datetime.

    Written out rather than left to Django, which turns a `date` handed to a
    DateTimeField lookup into naive midnight and warns while it does it. The
    boundary is the entire subject of the filter below, so it says it.
    """
    from django.utils import timezone

    return timezone.make_aware(datetime.combine(day, time.min))


@shared_task(**BASE, **RETRY_POLICY)
def cycle_scope_snapshot(self):
    """One row per running cycle, for the day the tick was fired on. Idempotent.

    `self` is here because RETRY_POLICY sets `bind=True`; beat still passes no arguments.
    """
    from django.db.models import Count, Q
    from django.utils import timezone

    from plane.arribada.models import CycleScopeSnapshot

    day = _recorded_day(timezone.localtime())

    # Running cycles only. A finished one cannot change scope, and an unstarted one
    # has nothing to record — writing rows for either would be noise that makes the
    # table look busier than the facts warrant.
    #
    # `start_date__lt` tomorrow's midnight, NOT `__lte` today's, and that one
    # operator is why this table never held a cycle's first day. A cycle's start is
    # an instant: `convert_to_utc` (plane/utils/timezone_converter.py) writes the
    # project's local midnight PLUS ONE SECOND, or the moment of creation when a
    # cycle starts on the day it is made. `start_date__lte=day` compares against
    # midnight EXACTLY, and no cycle in the product has ever started at exactly
    # midnight — so day one was excluded every time, on every cycle, and the
    # burndown began on day two.
    #
    # Day one is the day a scope-creep series least wants to lose: it is the
    # baseline every later point is read against, and a series missing it looks
    # like a cycle that was simply smaller at the start.
    #
    # A day is a half-open interval, so this asks the only question that has an
    # answer: did the cycle start before tomorrow began, and had it not ended when
    # today began.
    #
    # The boundaries are this instance's midnights (TIME_ZONE, UTC here), not each
    # project's. A project far enough east or west can therefore still pick up one
    # extra row at one end — its local day and the server's overlap by a few hours.
    # That is a row too many at a boundary, which the chart can show; the thing
    # being fixed is a row MISSING at day one, which it cannot.
    cycles = Cycle.objects.filter(
        start_date__lt=_midnight(day + timedelta(days=1)),
        end_date__gte=_midnight(day),
        project__archived_at__isnull=True,
    ).values_list("id", flat=True)

    written = 0
    for cycle_id in cycles:
        try:
            counts = Issue.issue_objects.filter(issue_cycle__cycle_id=cycle_id).aggregate(
                total=Count("id", distinct=True),
                completed=Count("id", filter=Q(state__group="completed"), distinct=True),
            )
            # update_or_create rather than create: beat can fire twice after a
            # restart, and a retry must correct the day rather than double it.
            CycleScopeSnapshot.objects.update_or_create(
                cycle_id=cycle_id,
                date=day,
                defaults={"total": counts["total"] or 0, "completed": counts["completed"] or 0},
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            # One bad cycle must not cost every other cycle its snapshot — a gap in
            # this series is permanent, because yesterday cannot be recomputed.
            log_exception(exc)

    # `day` travels back with the counts: a run that fired at 23:50 and a late
    # delivery of the same tick return different-looking clocks and the same day,
    # and that is the one thing an operator reading the worker log wants to check.
    return {"day": str(day), "cycles": len(cycles), "written": written}
