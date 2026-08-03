# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Turning person-days into a span, and the weekend arithmetic under it.

The interesting part is not the division — it is that effort is not duration.
Six person-days is a fortnight for one person and three days for two, and the
tests below are what stop that distinction quietly collapsing back into "days
means days" the next time somebody simplifies the function.

No database: `_add_working_days` is pure arithmetic on dates, and the span rule
is exercised through it.
"""

import math
from datetime import date

import pytest

from plane.arribada.views import _add_working_days


# --- weekend arithmetic ------------------------------------------------------

# A Monday, so the weekend lands predictably four days later.
MONDAY = date(2026, 8, 3)


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


# --- effort is not duration --------------------------------------------------


def span_for(days: float, people: int) -> int:
    """The rule the endpoint applies, stated once so the tests pin the rule
    rather than a copy of the arithmetic."""
    return max(1, math.ceil(float(days) / people))


def test_one_person_spends_the_whole_estimate():
    assert span_for(6, 1) == 6


def test_two_people_halve_it():
    assert span_for(6, 2) == 3


def test_a_team_larger_than_the_estimate_still_takes_a_day():
    """Ten people on a two-day task do not finish it in a fifth of a day. The
    floor is what stops a zero-length bar."""
    assert span_for(2, 10) == 1


def test_a_fractional_estimate_rounds_rather_than_truncating():
    """2.5 days over one person is three, not two: truncating would consistently
    under-plan every half-day estimate on the board."""
    assert span_for(2.5, 1) == 3
    assert span_for(7, 2) == 4
