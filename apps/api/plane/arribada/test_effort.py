# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Turning person-days into a span, through the endpoint that does it.

THIS FILE USED TO FAKE ITS OWN SUBJECT. It defined a local `span_for` helper — a
copy of one line of `_suggest_dates_from_effort` — and asserted against that. It
never created an `IssueRole` and never called the endpoint, so it could not see
the defect sitting three lines below the line it had copied:

    ProjectTeamMember.objects.filter(project_id=project_id, role=role)

The field is `roles`, plural, and it is a JSONField holding a list. Django raises
`FieldError`, so the effort endpoint answered 500 on exactly the state the
feature exists for — an item that HAS a discipline and is MISSING a date, which
is the only path that reaches that code at all.

The crash was not the damage. On POST the estimate is written before the
suggestion is computed, so the write succeeded and the response was a 500: the
user was told "Couldn't save the effort — It was not changed", watched the input
revert, and the budget charged the new number. Every other consumer of that
column iterates `roles` correctly, which is how one word survived five readers.

The weekend arithmetic below is unchanged and still pure — `_add_working_days` is
arithmetic on dates and needs no database. What follows it now goes through the
API.

Run explicitly: `python -m pytest plane/arribada/test_effort.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.models import IssueEffort, IssueRole, ProjectTeamMember
from plane.arribada.views import _add_working_days
from plane.db.models import Issue

# A Monday, so the weekend lands predictably four days later.
MONDAY = date(2026, 8, 3)


# --- weekend arithmetic ------------------------------------------------------


def test_zero_is_the_same_day():
    assert _add_working_days(MONDAY, 0) == MONDAY


def test_within_the_week_is_plain_addition():
    assert _add_working_days(MONDAY, 3) == date(2026, 8, 6)  # Thursday


def test_the_weekend_is_skipped_forwards():
    """Four working days from Monday is Friday; the fifth jumps the weekend."""
    assert _add_working_days(MONDAY, 4) == date(2026, 8, 7)  # Friday
    assert _add_working_days(MONDAY, 5) == date(2026, 8, 10)  # the next Monday


def test_a_full_working_fortnight_lands_two_weeks_on():
    assert _add_working_days(MONDAY, 10) == date(2026, 8, 17)


def test_the_weekend_is_skipped_backwards():
    """Anchoring on a target date walks the other way, and must skip too."""
    assert _add_working_days(MONDAY, -1) == date(2026, 7, 31)  # the Friday before
    assert _add_working_days(MONDAY, -3) == date(2026, 7, 29)


def test_starting_on_a_saturday_still_counts_working_days_only():
    """The anchor itself is never validated — a caller can hand in a weekend, and
    the count that follows must still land on weekdays."""
    saturday = date(2026, 8, 1)
    assert _add_working_days(saturday, 1) == date(2026, 8, 3)  # straight to Monday


@pytest.mark.parametrize("count", [1, 2, 5, 9, 23])
def test_the_result_is_never_a_weekend(count):
    assert _add_working_days(MONDAY, count).weekday() < 5
    assert _add_working_days(MONDAY, -count).weekday() < 5


# --- the endpoint ------------------------------------------------------------


@pytest.fixture
def undated(money_project):
    """A work item with a discipline and no dates.

    Both halves are required to reach the suggestion. An item with dates never
    gets one offered, and an item with no discipline skips the roster lookup —
    which is why a test file that created neither could sit green over a 500.
    """
    issue = Issue.objects.create(
        name="Bring up the radio",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        created_by=money_project["users"]["owner"],
    )
    IssueRole.objects.create(issue=issue, role="firmware")
    money_project["issue"] = issue
    return money_project


def effort_url(world):
    return reverse(
        "arribada-issue-effort",
        kwargs={
            "slug": world["slug"],
            "project_id": world["project_id"],
            "issue_id": str(world["issue"].id),
        },
    )


def holder(world, name, roles):
    return ProjectTeamMember.objects.create(
        project=world["project"], name=name, email=f"{name.lower()}@arribada.test", roles=roles
    )


def test_recording_an_effort_answers_rather_than_five_hundreds(undated):
    """The bug, at the surface a person meets it."""
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    assert response.status_code == 200, (
        f"the effort endpoint answered {response.status_code} on an item with a discipline and "
        "no dates — the one state that reaches the roster lookup."
    )
    assert response.data["days"] == 6.0


def test_the_estimate_that_was_saved_is_the_one_the_client_is_told_about(undated):
    """The real damage. The write happens before the suggestion, so a 500 there
    left the box reverted, a toast saying nothing had changed, and the budget
    charging the new figure."""
    undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    stored = IssueEffort.objects.get(issue=undated["issue"])
    assert float(stored.days) == 6.0

    reread = undated["clients"]["member"].get(effort_url(undated))
    assert reread.status_code == 200
    assert reread.data["days"] == 6.0


def test_reading_an_estimate_back_answers_too(undated):
    """The GET reaches the same code, through `suggested_dates`."""
    IssueEffort.objects.create(issue=undated["issue"], days=6)
    response = undated["clients"]["member"].get(effort_url(undated))
    assert response.status_code == 200, response.data
    assert response.data["suggested_dates"] is not None


# --- effort is not duration --------------------------------------------------


def test_one_person_spends_the_whole_estimate(undated):
    holder(undated, "Ruby", ["firmware"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    dates = response.data["suggested_dates"]
    assert dates is not None
    span = len(
        [
            d
            for d in range(0, 40)
            if _add_working_days(date.fromisoformat(dates["start_date"]), d)
            <= date.fromisoformat(dates["target_date"])
        ]
    )
    assert span == 6


def test_two_people_holding_the_discipline_halve_it(undated):
    """Six person-days is a fortnight for one person and three days for two. The
    divisor is how many people on the ROSTER hold this item's discipline — the
    lookup that was reading a column that does not exist."""
    holder(undated, "Ruby", ["firmware"])
    holder(undated, "Grant", ["firmware", "hardware"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    dates = response.data["suggested_dates"]
    assert dates["start_date"] != dates["target_date"]
    assert _add_working_days(date.fromisoformat(dates["start_date"]), 2) == date.fromisoformat(
        dates["target_date"]
    ), "two holders of the discipline did not halve the span — the roster lookup found nobody"


def test_somebody_holding_a_different_discipline_is_not_a_second_pair_of_hands(undated):
    holder(undated, "Ruby", ["firmware"])
    holder(undated, "Sam", ["software"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    dates = response.data["suggested_dates"]
    assert _add_working_days(date.fromisoformat(dates["start_date"]), 5) == date.fromisoformat(
        dates["target_date"]
    )


def test_the_roster_is_matched_case_insensitively(undated):
    """The discipline is free text typed on the work item and the roster's
    entries are typed on another screen. Every other reader here folds case;
    an exact JSON containment lookup would not."""
    holder(undated, "Ruby", ["Firmware"])
    holder(undated, "Grant", ["FIRMWARE"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    dates = response.data["suggested_dates"]
    assert _add_working_days(date.fromisoformat(dates["start_date"]), 2) == date.fromisoformat(
        dates["target_date"]
    )


def test_a_team_larger_than_the_estimate_still_takes_a_day(undated):
    """Ten people on a two-day task do not finish it in a fifth of a day. The
    floor is what stops a zero-length bar."""
    for i in range(10):
        holder(undated, f"Person{i}", ["firmware"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 2}, format="json")
    dates = response.data["suggested_dates"]
    assert dates["start_date"] == dates["target_date"]


def test_a_fractional_estimate_rounds_rather_than_truncating(undated):
    """2.5 days over one person is three, not two: truncating would consistently
    under-plan every half-day estimate on the board."""
    holder(undated, "Ruby", ["firmware"])
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 2.5}, format="json")
    dates = response.data["suggested_dates"]
    assert _add_working_days(date.fromisoformat(dates["start_date"]), 2) == date.fromisoformat(
        dates["target_date"]
    )


def test_an_item_that_already_has_both_dates_is_offered_nothing(undated):
    """A task with dates has been decided by a human. Proposing a replacement is
    noise."""
    Issue.objects.filter(id=undated["issue"].id).update(
        start_date=date(2026, 8, 3), target_date=date(2026, 8, 7)
    )
    response = undated["clients"]["member"].post(effort_url(undated), {"days": 6}, format="json")
    assert response.status_code == 200
    assert response.data["suggested_dates"] is None
