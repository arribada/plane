# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""One work item with a silly date must not take the project down.

This is the regression test that must never come back. Measured on the real
MARLIN project, 77 dated items, before the fix:

    one item's target date        gantt response
    ---------------------------   --------------------------------
    clean                             51 ms
    2050                           2,598 ms
    2500                          41,299 ms
    9999-12-31                    OverflowError -> HTTP 500, forever

"Forever" is the word that matters. `date + timedelta(days=1)` raises past
`date.max`, so two functions that walked the calendar a day at a time raised on
every request from then on — including the requests that would have shown you the
row to correct. There was no way out of it from inside the product.

The same row cost Finance 4.1 seconds at year 9000 and a permanent 500 at 9999.

And it was plantable by an ordinary project member: the "fix all undated items"
bulk action wrote whatever `_parse_date` returned, and `_parse_date` accepted any
year `date.fromisoformat` did.

Two locks, and this file tests both:

* the arithmetic no longer walks (`scheduling.weekdays_between`), so a poisoned
  row already in the database is survivable — which the DEFAULT tests below
  assert by writing one straight past the API and reading every endpoint that
  used to die on it;
* `_parse_date` refuses a date outside a plausible window, so no new one can be
  planted through the API.

Run explicitly: `python -m pytest plane/arribada/test_date_bomb.py`
"""

import time
from datetime import date, timedelta

import pytest
from django.urls import reverse
from freezegun import freeze_time

from plane.arribada.models import IssueRole, ProjectSchedule, WorkspaceRoleRate
from plane.arribada.scheduling import (
    cascade,
    critical_path,
    minus_working_days,
    plus_working_days,
    slack_for_issues,
    weekdays_between,
)
from plane.arribada.views import _parse_date, _working_days_between
from plane.db.models import Issue, IssueRelation

MONDAY = date(2026, 8, 3)
FRIDAY = date(2026, 8, 7)

# The end of the representable calendar. `date.max`.
DOOMSDAY = date(9999, 12, 31)

# `_parse_date`'s ceiling is fifty years from TODAY, so the two tests that probe
# the ceiling are the two that move with the runner's clock. Stopped on Europe's
# fall-back Sunday, late in the UTC day, so neither the calendar change nor a
# reader further east can shift what "this year" means mid-assertion.
NOW = "2026-10-25 23:30:00"


# ── the arithmetic itself ────────────────────────────────────────────────────
# No database, no fixtures: these are the two functions that raised.


def _walk_weekdays(start, end):
    """The implementation these replaced, kept as the oracle.

    Correct, and unusable at distance — which is the whole point. Every parity
    assertion below is against this, so "faster" can never quietly become
    "different".
    """
    if end < start:
        return 0
    day, count = start, 0
    while day <= end:
        if day.weekday() < 5:
            count += 1
        day += timedelta(days=1)
    return count


@pytest.mark.parametrize(
    "start,end",
    [
        (MONDAY, FRIDAY),  # a plain week
        (MONDAY, MONDAY),  # one day
        (date(2026, 8, 8), date(2026, 8, 9)),  # a weekend and nothing else
        (FRIDAY, MONDAY),  # backwards
        (date(2026, 1, 1), date(2028, 12, 31)),  # three years
    ],
)
def test_weekdays_between_matches_the_walk_it_replaced(start, end):
    assert weekdays_between(start, end) == _walk_weekdays(start, end)


def test_weekdays_between_survives_the_end_of_the_calendar():
    """The exact call that used to raise `OverflowError`.

    A second and a half of walking would have been survivable. Stepping off
    `date.max` is not: it is an exception, and the endpoint answered 500 to every
    caller from then on.
    """
    began = time.perf_counter()
    answer = weekdays_between(MONDAY, DOOMSDAY)
    assert answer > 2_000_000  # about eight thousand years of weekdays
    assert time.perf_counter() - began < 0.5


def test_slack_survives_one_item_dated_at_the_end_of_time():
    """`slack_for_issues` computes every task's float against the project HORIZON.

    So a single silly target date is not one slow task — it is every task on the
    project walking eight thousand years, and then raising. This is the shape the
    gantt endpoint hit.
    """
    issues = {
        "A": {"start": MONDAY, "target": FRIDAY},
        "B": {"start": MONDAY, "target": FRIDAY},
        "BOMB": {"start": MONDAY, "target": DOOMSDAY},
    }
    relations = [{"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"}]

    began = time.perf_counter()
    answer = slack_for_issues(issues, relations)
    assert time.perf_counter() - began < 1.0

    assert set(answer) == {"A", "B", "BOMB"}
    # The bomb reaches the horizon itself, so it has no float. The point is that
    # the other two still get an answer at all.
    assert answer["BOMB"]["total"] == 0
    assert answer["A"]["free"] >= 0


def test_cascade_and_critical_path_survive_it_too():
    issues = {
        "A": {"start": MONDAY, "target": DOOMSDAY},
        "B": {"start": MONDAY, "target": FRIDAY},
    }
    relations = [{"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"}]
    began = time.perf_counter()
    # B is pushed past A's target, which is date.max — there is no valid date
    # after it, so the honest outcome is "no move", not an exception.
    cascade(issues, relations)
    assert critical_path(issues, relations) == {"A", "B"}
    assert time.perf_counter() - began < 1.0


def test_working_days_between_survives_it():
    """The budget's duration fallback. Same walk, same raise, different screen."""
    began = time.perf_counter()
    assert _working_days_between(MONDAY, DOOMSDAY) > 2_000_000
    assert time.perf_counter() - began < 0.5


def test_working_days_between_still_floors_at_one():
    """The floor is the whole difference from `_count_working_days`. Keep it."""
    assert _working_days_between(MONDAY, MONDAY) == 1
    assert _working_days_between(FRIDAY, MONDAY) == 1  # backwards
    saturday, sunday = date(2026, 8, 8), date(2026, 8, 9)
    assert _working_days_between(saturday, sunday) == 1  # no working day in range


def test_working_days_between_subtracts_holidays_only_on_weekdays():
    holidays = frozenset({date(2026, 8, 5), date(2026, 8, 8)})  # a Wednesday, a Saturday
    assert _working_days_between(MONDAY, FRIDAY, holidays) == 4  # the Saturday is not a loss


@pytest.mark.parametrize("n", [0, 1, 4, 5, 6, 11, 250])
def test_working_day_arithmetic_matches_stepping(n):
    """Forwards and backwards, against the loops they replaced."""

    def step_forward(day, count):
        while day.weekday() >= 5:
            day += timedelta(days=1)
        for _ in range(count):
            day += timedelta(days=1)
            while day.weekday() >= 5:
                day += timedelta(days=1)
        return day

    def step_back(day, count):
        for _ in range(count):
            day -= timedelta(days=1)
            while day.weekday() >= 5:
                day -= timedelta(days=1)
        return day

    for offset in range(9):  # every weekday, both weekend days
        day = MONDAY + timedelta(days=offset)
        assert plus_working_days(day, n) == step_forward(day, n)
        assert minus_working_days(day, n) == step_back(day, n)


# ── the door: _parse_date ────────────────────────────────────────────────────


@freeze_time(NOW)
def test_parse_date_refuses_the_far_future():
    assert _parse_date("9999-12-31") is None
    assert _parse_date("2500-01-01") is None
    assert _parse_date("0001-01-01") is None
    assert _parse_date("1969-12-31") is None


@freeze_time(NOW)
def test_parse_date_still_takes_every_date_anybody_means():
    assert _parse_date("2026-08-03") == MONDAY
    assert _parse_date("2026-08-03T09:00:00Z") == MONDAY  # models like to append a time
    assert _parse_date("1970-01-01") == date(1970, 1, 1)
    # A grant that runs to the end of the decade after next is a real plan.
    horizon = date(date.today().year + 20, 1, 1)
    assert _parse_date(horizon.isoformat()) == horizon
    assert _parse_date("not a date") is None
    assert _parse_date(None) is None


# ── the door: the bulk action an ordinary member can press ───────────────────


def _undated_gap_url(world):
    return reverse(
        "arribada-project-undated-gap",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


@pytest.mark.django_db
@freeze_time(NOW)
def test_bulk_date_fix_refuses_to_plant_the_bomb(money_project):
    """`ProjectUndatedGapEndpoint.post` is the fix-all-undated-items button.

    It wrote whatever came back from `_parse_date` with only a `target < start`
    check, so `{"target_date": "9999-12-31"}` from any project member was a
    permanent 500 on that project's gantt and budget.
    """
    world = money_project
    issue = Issue.objects.create(
        name="Undated", project=world["project"], workspace=world["workspace"], state=world["state"]
    )
    response = world["clients"]["member"].post(
        _undated_gap_url(world),
        {"dates": {str(issue.id): {"start_date": "2026-08-03", "target_date": "9999-12-31"}}},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data == {"written": 0, "rejected": 1}, "refused, and SAID it refused"
    issue.refresh_from_db()
    assert issue.target_date is None, "nothing was written"


@pytest.mark.django_db
def test_bulk_date_fix_still_writes_a_sane_span(money_project):
    """Both ways. A guard that only proves refusal passes on a broken endpoint."""
    world = money_project
    issue = Issue.objects.create(
        name="Undated", project=world["project"], workspace=world["workspace"], state=world["state"]
    )
    response = world["clients"]["member"].post(
        _undated_gap_url(world),
        {"dates": {str(issue.id): {"start_date": "2026-08-03", "target_date": "2026-08-07"}}},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data == {"written": 1, "rejected": 0}
    issue.refresh_from_db()
    assert (issue.start_date, issue.target_date) == (MONDAY, FRIDAY)


# ── a row already in the database ────────────────────────────────────────────
# The clamp above stops NEW ones. These prove the existing one is survivable,
# which is the half that could not be fixed by validation.


def _plant_the_bomb(world):
    """A poisoned row, written past the API the way the old bulk action wrote it."""
    issue = Issue.objects.create(
        name="Ship it",
        project=world["project"],
        workspace=world["workspace"],
        state=world["state"],
        start_date=MONDAY,
        target_date=FRIDAY,
        created_by=world["users"]["owner"],
    )
    Issue.objects.filter(id=issue.id).update(target_date=DOOMSDAY)
    return issue


@pytest.mark.django_db
def test_critical_path_answers_with_a_poisoned_row_in_the_project(money_project):
    """The gantt's slack read. This is the endpoint that measured 41 s, then 500."""
    world = money_project
    bomb = _plant_the_bomb(world)
    healthy = Issue.objects.create(
        name="Also real",
        project=world["project"],
        workspace=world["workspace"],
        state=world["state"],
        start_date=MONDAY,
        target_date=FRIDAY,
        created_by=world["users"]["owner"],
    )
    IssueRelation.objects.create(
        issue=bomb,
        related_issue=healthy,
        relation_type="blocked_by",
        project=world["project"],
        workspace=world["workspace"],
    )

    url = reverse(
        "arribada-project-critical-path",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    began = time.perf_counter()
    response = world["clients"]["member"].get(url)
    elapsed = time.perf_counter() - began

    assert response.status_code == 200, response.data
    assert elapsed < 5.0, f"{elapsed:.1f}s — the walk is back"
    assert str(healthy.id) in response.data["slack"]


@pytest.mark.django_db
def test_budget_answers_with_a_poisoned_row_in_the_project(money_project):
    """Finance. Same row, same walk, 4.1 s at year 9000 and a 500 at 9999.

    The item has no recorded effort, so its cost falls back to the calendar span
    — which is exactly the path that walked.
    """
    world = money_project
    bomb = _plant_the_bomb(world)
    IssueRole.objects.create(issue=bomb, role="firmware")
    WorkspaceRoleRate.objects.create(
        workspace=world["workspace"], role="firmware", hourly_rate=100, hours_per_day=7, currency="GBP"
    )
    ProjectSchedule.objects.get_or_create(project=world["project"])

    url = reverse(
        "arribada-project-budget",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    began = time.perf_counter()
    response = world["clients"]["member"].get(url)
    elapsed = time.perf_counter() - began

    assert response.status_code == 200, response.data
    assert elapsed < 5.0, f"{elapsed:.1f}s — the walk is back"
