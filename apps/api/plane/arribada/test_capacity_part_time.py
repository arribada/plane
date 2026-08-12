# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A part-timer booked to the limit of their contract is at 100%, not 167%.

`_capacity_by_assignee` had no tests at all — not a fake, not a partial one, none
— which is how it shipped reading a permanent over-allocation for every person on
this instance who is not here five days a week.

THE ARITHMETIC IT GOT WRONG. A bar on the chart is a calendar span, and for a
part-timer the scheduler has already stretched that span to hold the work:
`_stretch_for_part_time` turns three days of work into five elapsed working days
for somebody here three days a week, and writes the five onto the item. So the
span already carries the part-time correction once. The denominator then applied
it a second time, in the same direction:

    contract      committed (elapsed)   available   read as
    ───────────   ───────────────────   ─────────   ───────
    5 days/week            40                40       100%   correct
    3 days/week            40                24       167%   permanent
    1 day/week             40                 8       500%   permanent

Nothing the person or their lead could do would bring those to 100% short of
giving work back, and a bar that shouts "over-allocated" at everybody part-time
says nothing about anybody: the one engineer genuinely drowning is
indistinguishable from the three who are simply not full-time.

WHY THE NUMBERS BELOW DO NOT DEPEND ON WHEN THE SUITE RUNS. Every item here spans
the WHOLE window the function looks at (today to today + 8 weeks), so the
committed days and the available days are counted over the same range with the
same holiday set — whatever today is, whatever bank holidays fall inside it, the
ratio is exact. A test that hard-coded "40 working days" would be a test that
fails every Easter.

Real rows and the real endpoint throughout, per `conftest.py`: the roster is a
`ProjectTeamMember`, the work is an `Issue` with an `IssueAssignee`, and the
figure asserted is the one `/workload/` puts on the screen.

Run explicitly: `python -m pytest plane/arribada/test_capacity_part_time.py`
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from plane.arribada.models import IssueAllocation, ProjectTeamMember
from plane.db.models import Issue, IssueAssignee

# The window `_capacity_by_assignee` reads, in its own terms. An item covering all
# of it is a person booked solid for as far ahead as the board looks.
WINDOW_WEEKS = 8


@pytest.fixture
def board(money_project):
    """The money project plus helpers for "put this person on this work"."""

    def roster(user, days_per_week=5, country="GB"):
        return ProjectTeamMember.objects.create(
            project=money_project["project"],
            member=user,
            name=user.first_name or user.email,
            email=user.email,
            roles=["firmware"],
            days_per_week=days_per_week,
            work_country=country,
        )

    def booked_solid(user, name="Solid", share=None):
        """One item covering the entire window, owned by `user`.

        `share` writes an `IssueAllocation`; leaving it None is the ordinary case
        the function reads as 100%.
        """
        today = timezone.localdate()
        issue = Issue.objects.create(
            name=name,
            project=money_project["project"],
            workspace=money_project["workspace"],
            state=money_project["state"],
            created_by=money_project["users"]["owner"],
            start_date=today,
            target_date=today + timedelta(weeks=WINDOW_WEEKS),
        )
        IssueAssignee.objects.create(
            issue=issue,
            assignee=user,
            project=money_project["project"],
            workspace=money_project["workspace"],
        )
        if share is not None:
            IssueAllocation.objects.create(issue=issue, assignee=user, percent=share)
        return issue

    money_project["roster"] = roster
    money_project["booked_solid"] = booked_solid
    return money_project


def workload(world, caller="owner"):
    url = reverse("arribada-workload", kwargs={"slug": world["slug"]})
    response = world["clients"][caller].get(url)
    assert response.status_code == 200, response.data
    return {row["user_id"]: row for row in response.data}


def person(world, label="member"):
    return world["users"][label]


# --- the control, and the two contracts that were broken ---------------------


def test_a_fully_booked_full_timer_reads_one_hundred_percent(board):
    """The case that was already right, asserted so the fix cannot break it.

    Without this the two tests below could be satisfied by deleting the part-time
    correction altogether, which would over-state a part-timer's capacity instead
    of over-stating their load — the same lie in the other direction.
    """
    who = person(board)
    board["roster"](who, days_per_week=5)
    board["booked_solid"](who)

    row = workload(board)[str(who.id)]
    assert row["committed_percent"] == 100


def test_a_fully_booked_three_day_week_reads_one_hundred_percent_not_167(board):
    who = person(board)
    board["roster"](who, days_per_week=3)
    board["booked_solid"](who)

    row = workload(board)[str(who.id)]
    assert row["committed_percent"] == 100, "the 167% that never went away"


def test_a_fully_booked_one_day_week_reads_one_hundred_percent_not_500(board):
    """The extreme the instance actually has: somebody who is here on Mondays.

    500% is not a rounding error, it is a bar drawn five times off the end of its
    own track.
    """
    who = person(board)
    board["roster"](who, days_per_week=1)
    board["booked_solid"](who)

    row = workload(board)[str(who.id)]
    assert row["committed_percent"] == 100


# --- the reading still has to mean something ---------------------------------


def test_half_a_part_timers_week_reads_fifty_percent(board):
    """A recorded share is a share of THAT PERSON's week, not of a full week.

    Half of a three-day-a-week engineer is a day and a half, and against a
    contract of three days that is 50%. Reading it against five days would report
    30% and hide the fact that they are half spoken for.
    """
    who = person(board)
    board["roster"](who, days_per_week=3)
    board["booked_solid"](who, share=50)

    row = workload(board)[str(who.id)]
    assert row["committed_percent"] == 50


def test_a_part_timer_can_still_be_over_allocated(board):
    """The fix must not be a clamp.

    Two items, each claiming the whole window, is genuinely twice as much work as
    the person has — and it has to keep reading as such, or the correction has
    simply moved the blindness from part-timers to everybody.
    """
    who = person(board)
    board["roster"](who, days_per_week=3)
    board["booked_solid"](who, name="Firmware")
    board["booked_solid"](who, name="Field prep")

    row = workload(board)[str(who.id)]
    assert row["committed_percent"] == 200


def test_the_contract_still_shrinks_the_days_available(board):
    """The denominator is untouched: the fix is on the numerator.

    A three-day-a-week engineer really does have fewer days in the window than a
    full-time one, and the board says so — `available_days` is what a lead reads
    to answer "can they take this on". Asserted as a ratio rather than a count so
    it holds whatever bank holidays the window happens to contain.
    """
    part_timer, full_timer = person(board, "member"), person(board, "lead")
    board["roster"](part_timer, days_per_week=3)
    board["roster"](full_timer, days_per_week=5)
    board["booked_solid"](part_timer, name="Firmware")
    board["booked_solid"](full_timer, name="Enclosure")

    rows = workload(board)
    part = rows[str(part_timer.id)]["available_days"]
    full = rows[str(full_timer.id)]["available_days"]
    assert part == pytest.approx(full * 0.6, abs=0.1)
    # And the committed side moved with it, which is the whole point.
    assert rows[str(part_timer.id)]["committed_days"] == pytest.approx(part, abs=0.1)
