# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The holiday tables, checked against dates a person can verify.

Pure arithmetic, no database. Run explicitly:
`python -m pytest plane/arribada/tests_holidays.py`

Every expected date below is a real published bank holiday, not a value read back
out of this module — a test that asserts the code agrees with itself proves
nothing.
"""

from datetime import date

from plane.arribada.holidays import easter_sunday, holidays_for


def test_easter_matches_published_dates():
    """Four years off the church's own tables, spanning a century boundary."""
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert easter_sunday(2027) == date(2027, 3, 28)
    assert easter_sunday(2030) == date(2030, 4, 21)
    assert easter_sunday(2000) == date(2000, 4, 23)


def test_uk_2026_bank_holidays():
    days = holidays_for("GB", date(2026, 1, 1), date(2026, 12, 31))
    assert days[date(2026, 1, 1)] == "New Year's Day"
    assert days[date(2026, 4, 3)] == "Good Friday"  # Easter 5 April
    assert days[date(2026, 4, 6)] == "Easter Monday"
    assert days[date(2026, 5, 4)] == "Early May bank holiday"
    assert days[date(2026, 5, 25)] == "Spring bank holiday"
    assert days[date(2026, 8, 31)] == "Summer bank holiday"
    assert days[date(2026, 12, 25)] == "Christmas Day"
    assert len(days) == 8


def test_christmas_on_a_weekend_pushes_boxing_day_past_the_substitute():
    """2027: Christmas is a Saturday and Boxing Day a Sunday.

    The published substitutes are Monday 27 and Tuesday 28 December. A naive
    "move to the next Monday" would put both on the 27th and lose a day — which is
    how a plan silently gains a working day nobody works.
    """
    days = holidays_for("GB", date(2027, 12, 1), date(2027, 12, 31))
    assert days[date(2027, 12, 27)] == "Christmas Day"
    assert days[date(2027, 12, 28)] == "Boxing Day"
    assert date(2027, 12, 25) not in days
    assert date(2027, 12, 26) not in days


def test_new_year_on_a_saturday_moves_to_the_monday():
    # 1 January 2028 is a Saturday; the substitute is Monday the 3rd.
    days = holidays_for("GB", date(2028, 1, 1), date(2028, 1, 31))
    assert days[date(2028, 1, 3)] == "New Year's Day"
    assert date(2028, 1, 1) not in days


def test_france_2026():
    days = holidays_for("FR", date(2026, 1, 1), date(2026, 12, 31))
    assert days[date(2026, 7, 14)] == "Fête nationale"
    assert days[date(2026, 5, 14)] == "Ascension"  # Easter 5 April + 39
    assert days[date(2026, 5, 25)] == "Lundi de Pentecôte"  # + 50
    assert days[date(2026, 8, 15)] == "Assomption"
    assert len(days) == 11


def test_france_does_not_substitute():
    """1 May 2027 is a Saturday. France loses it; it does not move to the Monday."""
    days = holidays_for("FR", date(2027, 5, 1), date(2027, 5, 10))
    assert days[date(2027, 5, 1)] == "Fête du Travail"
    assert date(2027, 5, 3) not in days


def test_the_two_countries_disagree():
    """The whole reason this is per person rather than per workspace."""
    window = (date(2026, 7, 1), date(2026, 7, 31))
    assert date(2026, 7, 14) in holidays_for("FR", *window)
    assert date(2026, 7, 14) not in holidays_for("GB", *window)

    december = (date(2026, 12, 20), date(2026, 12, 31))
    assert date(2026, 12, 28) in holidays_for("GB", *december)  # Boxing Day substitute
    assert date(2026, 12, 28) not in holidays_for("FR", *december)


def test_an_unknown_country_costs_that_person_their_holidays_not_the_reflow():
    assert holidays_for("DE", date(2026, 1, 1), date(2026, 12, 31)) == {}
    assert holidays_for(None, date(2026, 7, 1), date(2026, 7, 31)) == {}  # None -> default GB, no 14 July


def test_a_range_spanning_two_years_gets_both():
    days = holidays_for("GB", date(2026, 12, 1), date(2027, 1, 31))
    assert date(2026, 12, 25) in days
    assert date(2027, 1, 1) in days
