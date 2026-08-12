# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The nightly scope snapshot, and the two days it kept getting wrong.

This task exists to answer "what did this cycle hold on the 3rd", because the
burndown recomputes every past point from the CURRENT total and therefore hides
scope creep — the one thing a burndown is worth drawing for. A missing day is
not a cosmetic gap: nothing in the schema can reconstruct it afterwards.

Two defects, both of them the same mistake made twice — treating a PLAN DATE as
an instant, or an instant as a plain day:

* `start_date__lte=today` compared a cycle's start against midnight EXACTLY, and
  no cycle in this product starts at midnight. `convert_to_utc` writes the
  project's local midnight plus one second, or the moment of creation for a cycle
  that starts on the day it is made. So every cycle's FIRST day was excluded, on
  every project, and the series began on day two — losing precisely the baseline
  the later points are read against.
* the row was stamped `timezone.now().date()`, read at whatever moment the worker
  happened to wake up. Beat fires this ten minutes before midnight, so any
  retry, redelivery or late delivery wrote the row under TOMORROW — where
  tomorrow's own run then overwrote it, and the day the tick was fired for ended
  with no row at all.

Every test here is frozen, and frozen somewhere deliberately hostile: Sunday 25
October 2026 is the European fall-back, and 23:50 UTC is a moment at which a
reader in Auckland is already most of the way through the 26th. A test that
passes only because the runner's clock happened to sit in the middle of a UTC day
is not testing this task at all.

The cycles are built by calling `convert_to_utc` — the product's own
cycle-creation path — rather than by writing tidy midnights nothing ever stores.
The whole defect lived in the one second between those two.

Run explicitly: `python -m pytest plane/arribada/test_scope_snapshot.py`
"""

from datetime import date, datetime, timedelta, timezone as dt_timezone

from freezegun import freeze_time

from plane.arribada.models import CycleScopeSnapshot
from plane.arribada.scope_snapshot_task import _recorded_day, cycle_scope_snapshot
from plane.db.models import Cycle, CycleIssue, Issue, Project
from plane.utils.timezone_converter import convert_to_utc

# The day under test, and the moment beat fires for it. See plane/celery.py.
DAY = date(2026, 10, 25)
TICK = "2026-10-25 23:50:00"

# When the cycles below were PLANNED. Kept away from the day under test on
# purpose: `convert_to_utc` has a branch that returns the current instant when a
# cycle starts on the day it is created, and the ordinary case — a cycle planned
# in advance, stored as local midnight plus one second — is the one that was
# being dropped.
PLANNED_ON = "2026-10-20 10:00:00"


def plan_cycle(
    world, name="Sprint 1", start="2026-10-25", end="2026-10-30", project=None, planned_on=PLANNED_ON
):
    """A cycle whose dates are written the way the product writes them.

    Through `convert_to_utc`, not around it: this is the fork's own cycle
    serializer path (plane/app/serializers/cycle.py), and a fixture that builds
    a tidier instant than the product stores is a fixture that cannot see this
    bug.
    """
    project = project or world["project"]
    with freeze_time(planned_on):
        return Cycle.objects.create(
            name=name,
            project=project,
            workspace=world["workspace"],
            owned_by=world["users"]["owner"],
            start_date=convert_to_utc(start, project.id, is_start_date=True),
            end_date=convert_to_utc(end, project.id),
        )


def put_in(world, cycle, name="Item", done=False):
    issue = Issue.objects.create(
        name=name,
        project=cycle.project,
        workspace=world["workspace"],
        state=world["done_state"] if done else world["state"],
        created_by=world["users"]["owner"],
    )
    CycleIssue.objects.create(
        cycle=cycle, issue=issue, project=cycle.project, workspace=world["workspace"]
    )
    return issue


def days_recorded(cycle):
    return sorted(CycleScopeSnapshot.objects.filter(cycle=cycle).values_list("date", flat=True))


# --- which day a run is recording -------------------------------------------


def test_the_recorded_day_is_the_day_the_tick_was_fired_on():
    """No database: this is the whole of the second defect, in one function.

    A run is not always recording the day it is running on, and the difference
    is only ever ten minutes wide — which is exactly why it survived.
    """
    utc = dt_timezone.utc
    on_time = datetime(2026, 10, 25, 23, 50, tzinfo=utc)
    assert _recorded_day(on_time) == DAY

    # Three seconds late over a day boundary. `now().date()` said the 26th here,
    # and the 26th's own run overwrote the row that evening.
    assert _recorded_day(datetime(2026, 10, 26, 0, 0, 3, tzinfo=utc)) == DAY
    # A retry that backed off the better part of an hour still belongs to the 25th.
    assert _recorded_day(datetime(2026, 10, 26, 0, 59, 59, tzinfo=utc)) == DAY

    # And a person running it by hand in the morning gets the day they are
    # standing in, which is the only reading that would make sense to them.
    assert _recorded_day(datetime(2026, 10, 26, 1, 0, 0, tzinfo=utc)) == date(2026, 10, 26)
    assert _recorded_day(datetime(2026, 10, 26, 9, 30, tzinfo=utc)) == date(2026, 10, 26)


@freeze_time(TICK)
def test_a_late_delivery_records_the_day_its_tick_was_for(money_project):
    """Same thing again, through the task and a real row.

    The failure this prevents is not a wrong row, it is a LOST day: the row
    lands under the 26th, the 26th's own 23:50 run overwrites it with the 26th's
    figures, and the 25th is gone with nothing to rebuild it from.
    """
    cycle = plan_cycle(money_project)
    put_in(money_project, cycle)

    with freeze_time("2026-10-26 00:04:00"):
        cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY], "the late run spent the 26th's row on the 25th's figures"


# --- which cycles are running today -----------------------------------------


@freeze_time(TICK)
def test_the_first_day_of_a_cycle_is_snapshotted(money_project):
    """THE regression. A cycle starting today has a row for today.

    `start_date__lte=today` turned the date into midnight exactly, and the stored
    start is one second past it — so this row was never written, for any cycle,
    on any project, and the burndown began on day two.
    """
    cycle = plan_cycle(money_project, start="2026-10-25", end="2026-10-30")
    put_in(money_project, cycle)

    # The one second the whole defect lived in, stated rather than implied.
    assert cycle.start_date == datetime(2026, 10, 25, 0, 0, 1, tzinfo=dt_timezone.utc)

    result = cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY], "day one of the cycle was not recorded"
    assert result == {"day": "2026-10-25", "cycles": 1, "written": 1}


@freeze_time(TICK)
def test_a_cycle_created_on_the_day_it_starts_is_snapshotted_too(money_project):
    """The other shape `convert_to_utc` writes: a cycle starting today, planned
    today, is stored at the MOMENT OF CREATION rather than at midnight — half a
    day past the boundary the old filter compared against, and still excluded."""
    cycle = plan_cycle(
        money_project, name="Started today", start="2026-10-25", planned_on="2026-10-25 12:00:00"
    )
    assert cycle.start_date == datetime(2026, 10, 25, 12, 0, tzinfo=dt_timezone.utc)

    cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY]


@freeze_time(TICK)
def test_the_last_day_of_a_cycle_is_snapshotted(money_project):
    """The far boundary, which the same filter got right and must keep getting
    right: a cycle ends at the project's local 23:59, not at midnight."""
    cycle = plan_cycle(money_project, start="2026-10-01", end="2026-10-25")
    put_in(money_project, cycle)

    cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY], "the cycle's final day was not recorded"


@freeze_time(TICK)
def test_a_cycle_that_starts_tomorrow_is_not_recorded_yet(money_project):
    """The guard on the fix. Widening the start boundary must not sweep in a
    cycle nobody has begun — its rows would read as a cycle that held nothing."""
    cycle = plan_cycle(money_project, start="2026-10-26", end="2026-11-30")
    put_in(money_project, cycle)

    assert cycle_scope_snapshot() == {"day": "2026-10-25", "cycles": 0, "written": 0}
    assert days_recorded(cycle) == []


@freeze_time(TICK)
def test_a_cycle_that_ended_yesterday_is_not_recorded_any_more(money_project):
    """A finished cycle cannot change scope. Rows after the end would draw a
    flat tail on the burndown that reads as work that stopped moving."""
    cycle = plan_cycle(money_project, start="2026-10-01", end="2026-10-24")
    put_in(money_project, cycle)

    cycle_scope_snapshot()

    assert days_recorded(cycle) == []


@freeze_time(TICK)
def test_an_archived_projects_cycles_are_left_alone(money_project):
    """Nobody is running the sprint of an archived project, and a nightly write
    against one is a table that looks busier than the facts warrant."""
    shelved = Project.objects.create(
        name="Shelved",
        workspace=money_project["workspace"],
        created_by=money_project["users"]["owner"],
        identifier="SHL",
    )
    Project.objects.filter(id=shelved.id).update(archived_at=datetime(2026, 9, 1, tzinfo=dt_timezone.utc))
    cycle = plan_cycle(money_project, name="Shelved sprint", project=shelved)

    cycle_scope_snapshot()

    assert days_recorded(cycle) == []


# --- what the row says -------------------------------------------------------


@freeze_time(TICK)
def test_the_row_counts_what_the_cycle_holds_and_what_is_done(money_project):
    """The figures themselves. `completed` is the state GROUP, not a state name:
    a project renames its columns and the burndown must not stop counting."""
    cycle = plan_cycle(money_project)
    put_in(money_project, cycle, name="Open one")
    put_in(money_project, cycle, name="Open two")
    put_in(money_project, cycle, name="Shipped", done=True)

    cycle_scope_snapshot()

    row = CycleScopeSnapshot.objects.get(cycle=cycle, date=DAY)
    assert (row.total, row.completed) == (3, 1)


@freeze_time(TICK)
def test_running_twice_corrects_the_day_rather_than_doubling_it(money_project):
    """Beat can fire twice after a restart, and `acks_late` redelivers a message
    whose worker was killed. Both land here as a second run of the same tick."""
    cycle = plan_cycle(money_project)
    put_in(money_project, cycle, name="First")

    cycle_scope_snapshot()
    put_in(money_project, cycle, name="Second")
    cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY], "the same day was recorded twice"
    assert CycleScopeSnapshot.objects.get(cycle=cycle, date=DAY).total == 2


@freeze_time(TICK)
def test_a_run_the_next_night_adds_a_day_rather_than_replacing_one(money_project):
    """The series is the product. Two nights, two rows, and the first one keeps
    the figure it was written with — that is the whole reason this table exists."""
    cycle = plan_cycle(money_project, start="2026-10-25", end="2026-10-30")
    put_in(money_project, cycle, name="First")
    cycle_scope_snapshot()

    with freeze_time("2026-10-26 23:50:00"):
        put_in(money_project, cycle, name="Crept in")
        cycle_scope_snapshot()

    assert days_recorded(cycle) == [DAY, DAY + timedelta(days=1)]
    assert CycleScopeSnapshot.objects.get(cycle=cycle, date=DAY).total == 1, (
        "the first day was rewritten from today's total — which is the retroactive "
        "reshaping this table exists to prevent"
    )
