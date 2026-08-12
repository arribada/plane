# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""`_holidays_for` needs a RANGE, and two callers were not giving it one.

Read its signature and the reason is in the docstring: the workspace's
hand-entered closures come back always, and the STATUTORY half — Christmas, Good
Friday, the August bank holiday, the 14th of July — is computed only when a start
and an end are supplied. `_holidays_for(slug)` therefore returns a calendar with
no public holidays in it at all, and it does so silently, because a set that is
merely smaller than it should be looks exactly like a workspace that has not
entered any closures.

Two call sites had it, and they are the two that matter most:

* THE PLANNER (`ProjectSetupPlanEndpoint`). It scheduled work onto Christmas Day
  — and this is the one call in the file whose answer is WRITTEN: the apply step
  stores these dates on real work items, so unlike a bar drawn a day wide, the
  mistake outlives the request and has to be undone by hand afterwards.
* THE CONFLICT SWEEP (`WorkloadTimelineEndpoint`). It counted bank holidays as
  days two tasks collided on — inventing conflict days nobody could have worked,
  on the one screen whose entire job is to be believed about a double-booking.

The dates below are checked arithmetic, not values read back out of the code.
Christmas Day 2026 is a Friday, Boxing Day the Saturday after it, so the Boxing
Day substitute is Monday 28 December: a two-day task starting Thursday 24
December runs 24 -> 29, not 24 -> 25.

Run explicitly: `python -m pytest plane/arribada/test_holiday_ranges.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.models import ProjectTeamMember, WorkspaceNonWorkingDay
from plane.db.models import Issue, IssueAssignee

# Christmas week 2026, which is the whole point of this file.
#
#   Thu 24 Dec   a working day
#   Fri 25 Dec   Christmas Day
#   Sat 26 Dec   Boxing Day, on a weekend
#   Mon 28 Dec   Boxing Day's substitute
#   Tue 29 Dec   the next day anybody works
CHRISTMAS_EVE = date(2026, 12, 24)
CHRISTMAS_DAY = date(2026, 12, 25)
BACK_TO_WORK = date(2026, 12, 29)


def plan(world, start, days=2, caller="owner"):
    """One two-day task, planned from `start`. The smallest thing that shows it."""
    url = reverse(
        "arribada-project-setup-plan",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"][caller].post(
        url,
        {
            "task_keys": ["pm.kickoff"],
            "duration_overrides": {"pm.kickoff": days},
            "start_date": start.isoformat(),
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    return response.data


# --- the planner -------------------------------------------------------------


def test_the_planner_will_not_end_a_task_on_christmas_day(money_project):
    """THE regression. Without the range this returned 2026-12-25.

    The assertion is on the exact date rather than "not Christmas", because a
    scheduler that avoids the 25th by losing a day somewhere else is not fixed
    either: 24 -> 29 is the answer that says it skipped Christmas, the weekend and
    the Boxing Day substitute, and counted none of them as work.
    """
    payload = plan(money_project, CHRISTMAS_EVE)
    task = payload["tasks"][0]

    assert task["start_date"] == CHRISTMAS_EVE.isoformat()
    assert task["target_date"] == BACK_TO_WORK.isoformat()
    assert task["target_date"] != CHRISTMAS_DAY.isoformat()


def test_the_planner_still_respects_a_hand_entered_closure(money_project):
    """The half that already worked, pinned so the range cannot cost it.

    `_holidays_for` returns WorkspaceNonWorkingDay rows whether or not it is given
    a range, so this passed before — and a fix that swapped one source for the
    other instead of adding to it would break the lab shutdown while curing
    Christmas.
    """
    WorkspaceNonWorkingDay.objects.create(
        workspace=money_project["workspace"], date=CHRISTMAS_EVE, name="Lab shutdown"
    )

    task = plan(money_project, CHRISTMAS_EVE)["tasks"][0]
    # Christmas Eve is closed, then Christmas, the weekend and the substitute.
    assert task["start_date"] == BACK_TO_WORK.isoformat()
    assert task["target_date"] == date(2026, 12, 30).isoformat()


def test_a_plan_nowhere_near_a_holiday_is_unchanged(money_project):
    """The control: an ordinary week still costs exactly its own days.

    Monday 3 August 2026 to Tuesday the 4th. The summer bank holiday is the last
    Monday of the month, four weeks away, so nothing here should move — a fix that
    made every plan longer would pass the two tests above and be useless.
    """
    task = plan(money_project, date(2026, 8, 3))["tasks"][0]
    assert (task["start_date"], task["target_date"]) == ("2026-08-03", "2026-08-04")


# --- the conflict sweep ------------------------------------------------------


@pytest.fixture
def double_booked(money_project):
    """One person, two items, both live for the whole of 21-31 December 2026.

    Nine weekdays. How many of them are a conflict depends entirely on whose
    calendar is being read, which is the thing under test.
    """

    def book(name):
        issue = Issue.objects.create(
            name=name,
            project=money_project["project"],
            workspace=money_project["workspace"],
            state=money_project["state"],
            created_by=money_project["users"]["owner"],
            start_date=date(2026, 12, 21),
            target_date=date(2026, 12, 31),
        )
        IssueAssignee.objects.create(
            issue=issue,
            assignee=money_project["users"]["member"],
            project=money_project["project"],
            workspace=money_project["workspace"],
        )
        return issue

    book("Firmware bring-up")
    book("Field prep")
    return money_project


def timeline(world, caller="owner"):
    url = reverse("arribada-workload-timeline", kwargs={"slug": world["slug"]})
    response = world["clients"][caller].get(url, {"from": "2026-12-01", "to": "2027-01-15"})
    assert response.status_code == 200, response.data
    return response.data


def row_for(payload, user):
    return next(p for p in payload["people"] if p["user_id"] == str(user.id))


def test_the_conflict_sweep_does_not_count_christmas_as_a_working_day(double_booked):
    """Nine weekdays in the range, seven of them worked.

    Before the range was passed this reported nine, so the board told a lead their
    engineer was double-booked for two days that the country was shut.
    """
    payload = timeline(double_booked)
    row = row_for(payload, double_booked["users"]["member"])

    assert row["conflict_count"] == 1
    assert row["conflict_days"] == 7


def test_the_conflict_sweep_uses_each_persons_own_country(double_booked):
    """The 26th of December is not a French engineer's day off.

    France keeps Noël and has no substitution rule, so the same fortnight is eight
    worked days there and seven here. A single workspace calendar cannot say both,
    which is why `_holidays_for` takes a country and why this call now passes one.
    """
    ProjectTeamMember.objects.create(
        project=double_booked["project"],
        member=double_booked["users"]["member"],
        name="Camille",
        email=double_booked["users"]["member"].email,
        roles=["firmware"],
        work_country="FR",
    )

    row = row_for(timeline(double_booked), double_booked["users"]["member"])
    assert row["conflict_days"] == 8


def test_the_timeline_shades_the_statutory_holidays_too(double_booked):
    """The chart's own shading, which came back empty for the same reason.

    One shared axis cannot be drawn in two countries at once, so this is the
    workspace default — the per-person answer is the conflict sweep above.
    """
    holidays = timeline(double_booked)["holidays"]
    assert str(CHRISTMAS_DAY) in [str(d) for d in holidays]
