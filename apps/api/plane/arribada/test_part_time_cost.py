# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A calendar span is not an effort, and a part-time engineer is not expensive.

`_stretch_for_part_time` widens a task's CALENDAR window for somebody who is not
here five days a week: three days of work at three days a week takes five working
days to elapse. That is right, and it is a duration.

The setup wizard then wrote those widened dates onto the work items and wrote no
`IssueEffort` at all — the estimate it had planned the whole thing from was on the
wire and this endpoint dropped it. The budget prefers a recorded effort and falls
back to the span, so every wizard-built task fell through to the fallback and the
stretched span was charged as person-days. A three-day task for a three-day-a-week
engineer billed five: 67% too much, and 150% at one day a week. Somebody working
Mondays does not cost five times somebody working Monday to Friday.

`int()` made it worse in the other direction: the stretch truncated before it
multiplied, so half a day of work simply disappeared and a 2.5-day task came out
the same length as a 2-day one for everyone part-time.

Run explicitly: `python -m pytest plane/arribada/test_part_time_cost.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.blueprints import _stretch_for_part_time
from plane.arribada.models import IssueEffort, WorkspaceRoleRate
from plane.db.models import Issue

MONDAY = date(2026, 8, 3)


# --- the stretch itself ------------------------------------------------------


def test_full_time_is_not_stretched():
    assert _stretch_for_part_time(3, 5) == 3


def test_three_days_a_week_takes_a_full_week_to_do_three_days_of_work():
    assert _stretch_for_part_time(3, 3) == 5


def test_one_day_a_week_takes_five_weeks_to_do_five_days_of_work():
    assert _stretch_for_part_time(5, 1) == 25


def test_a_half_day_survives_the_stretch():
    """`int(days)` truncated before multiplying, so 2.5 days at three days a week
    came out 4 — the same as a 2-day task — and the half day was simply gone."""
    assert _stretch_for_part_time(2.5, 3) == 5


def test_a_missing_or_nonsense_pattern_reads_as_full_time():
    """The column defaults to 5 and a roster row imported from the wiki may carry
    anything. A stretch is not the place to raise."""
    for value in (None, 0, "", "nonsense", 9):
        assert _stretch_for_part_time(4, value) in (4, 20), value


# --- and the effort the wizard has to write down -----------------------------


@pytest.fixture
def wizard(money_project):
    WorkspaceRoleRate.objects.create(
        workspace=money_project["workspace"],
        role="firmware",
        hourly_rate=100,
        hours_per_day=7,
        currency="GBP",
    )
    return money_project


def apply_plan(world, tasks):
    url = reverse(
        "arribada-project-setup-apply",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"]["member"].post(url, {"tasks": tasks}, format="json")
    assert response.status_code in (200, 201), response.data
    return response.data


def budget(world):
    url = reverse(
        "arribada-project-budget",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"]["member"].get(url)
    assert response.status_code == 200, response.data
    return response.data


# Three days of work, placed by the scheduler across a full week because the
# person doing it is here three days a week. This is exactly what the wizard
# sends: `days` is the effort, `start_date`/`target_date` are the elapsed window.
PART_TIME_TASK = {
    "key": "fw.bringup",
    "name": "Radio bring-up",
    "track": "firmware",
    "role": "firmware",
    "days": 3,
    "start_date": "2026-08-03",
    "target_date": "2026-08-07",
}


def test_applying_a_plan_records_the_effort_it_planned_from(wizard):
    apply_plan(wizard, [PART_TIME_TASK])
    issue = Issue.objects.get(project=wizard["project"], name="Radio bring-up")
    assert IssueEffort.objects.filter(issue=issue).exists(), (
        "the wizard wrote the dates and dropped the estimate it had planned them from, "
        "so the budget fell through to charging the calendar span as person-days"
    )
    assert float(IssueEffort.objects.get(issue=issue).days) == 3.0


def test_a_part_time_task_is_charged_for_the_work_and_not_for_the_week(wizard):
    """Three days at £100 x 7 hours is £2,100. The five-day window it occupies is
    £3,500 — a 67% overcharge for the crime of working three days a week."""
    apply_plan(wizard, [PART_TIME_TASK])
    payload = budget(wizard)
    assert payload["labour"]["totals"] == [{"currency": "GBP", "amount": 2100.0}], (
        "a part-time engineer's task was billed for its calendar span rather than its effort"
    )
    assert payload["labour"]["from_effort"] == 1
    assert payload["labour"]["from_span"] == 0


def test_a_task_with_no_estimate_still_falls_back_to_its_span(wizard):
    """The fallback is right where there is nothing better — an item nobody has
    estimated. What was wrong was reaching it for every item in the plan."""
    apply_plan(wizard, [{**PART_TIME_TASK, "name": "Unestimated", "key": "fw.x", "days": 0}])
    payload = budget(wizard)
    assert payload["labour"]["from_span"] == 1
    assert payload["labour"]["totals"] == [{"currency": "GBP", "amount": 3500.0}]


def test_re_running_the_wizard_does_not_double_the_estimate(wizard):
    """Applying a plan is re-runnable on purpose: a task whose name already exists
    is skipped. The effort write has to be skipped with it."""
    apply_plan(wizard, [PART_TIME_TASK])
    apply_plan(wizard, [PART_TIME_TASK])
    assert Issue.objects.filter(project=wizard["project"], name="Radio bring-up").count() == 1
    assert IssueEffort.objects.filter(issue__project=wizard["project"]).count() == 1
    assert budget(wizard)["labour"]["totals"] == [{"currency": "GBP", "amount": 2100.0}]
