# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public holidays for the two countries this team works from.

Why a table in the code rather than an API
-------------------------------------------
The scheduler runs on every reflow and every plan. Putting a network call on that
path means a planner that fails when somebody else's service is down, and a
holiday list that can change under a plan between two reads. These dates are known
years ahead and change about once a decade; a table is the honest shape.

Why per person rather than per project
---------------------------------------
The 14th of July is not a British engineer's day off and Boxing Day is not a
French one's, and this team spans both. A person's country comes from their
CENTRAL profile — the one the wiki, Zulip, Plane and the dashboard share — and
reaches Plane through the SSO userinfo. Someone who has not said gets GB, the
workspace default.

What is NOT here
----------------
The organisation's own closures — the week between Christmas and New Year, a
lab shutdown — stay in WorkspaceNonWorkingDay, entered by hand. Those are
decisions, not law, and they differ from one year to the next.

Scotland and Northern Ireland have their own bank holidays (2 January, 12 July,
St Andrew's Day). This is England-and-Wales, which is where the UK half of the
team is. Adding a region later means another key, not a different shape.
"""

from datetime import date, timedelta


def easter_sunday(year):
    """Anonymous Gregorian computus. Exact for 1583-4099.

    Written out rather than pulled from `dateutil` because four of the eight
    holidays below hang off it, and a scheduler should not gain a dependency for
    twenty lines of arithmetic.
    """
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    lam = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * lam) // 451
    month, day = divmod(h + lam - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _nth_weekday(year, month, weekday, n):
    """The nth `weekday` of a month. n=-1 means the last one."""
    if n > 0:
        first = date(year, month, 1)
        offset = (weekday - first.weekday()) % 7
        return first + timedelta(days=offset + 7 * (n - 1))
    last_day = (date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)).day
    last = date(year, month, last_day)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _substitute(day, taken):
    """A UK bank holiday landing on a weekend moves to the next free weekday.

    "Next free" rather than "next Monday": Christmas Day on a Saturday pushes
    Boxing Day to the Tuesday, because the Monday is already Christmas's
    substitute. Getting this wrong is how a plan gains a working day nobody works.
    """
    while day.weekday() >= 5 or day in taken:
        day += timedelta(days=1)
    return day


def _gb(year):
    """England and Wales bank holidays."""
    easter = easter_sunday(year)
    days = {}

    def put(day, name):
        days[_substitute(day, days)] = name

    put(date(year, 1, 1), "New Year's Day")
    # Good Friday and Easter Monday never need a substitute — they cannot land on
    # a weekend by construction.
    days[easter - timedelta(days=2)] = "Good Friday"
    days[easter + timedelta(days=1)] = "Easter Monday"
    days[_nth_weekday(year, 5, 0, 1)] = "Early May bank holiday"
    days[_nth_weekday(year, 5, 0, -1)] = "Spring bank holiday"
    days[_nth_weekday(year, 8, 0, -1)] = "Summer bank holiday"
    put(date(year, 12, 25), "Christmas Day")
    put(date(year, 12, 26), "Boxing Day")
    return days


def _fr(year):
    """French public holidays.

    No substitution rule: a French holiday falling on a Sunday is simply lost,
    which is why 2027's 1 May is not compensated.
    """
    easter = easter_sunday(year)
    return {
        date(year, 1, 1): "Jour de l'An",
        easter + timedelta(days=1): "Lundi de Pâques",
        date(year, 5, 1): "Fête du Travail",
        date(year, 5, 8): "Victoire 1945",
        easter + timedelta(days=39): "Ascension",
        easter + timedelta(days=50): "Lundi de Pentecôte",
        date(year, 7, 14): "Fête nationale",
        date(year, 8, 15): "Assomption",
        date(year, 11, 1): "Toussaint",
        date(year, 11, 11): "Armistice 1918",
        date(year, 12, 25): "Noël",
    }


BUILDERS = {"GB": _gb, "FR": _fr}

DEFAULT_COUNTRY = "GB"

COUNTRIES = [
    {"value": "GB", "label": "United Kingdom (England & Wales)"},
    {"value": "FR", "label": "France"},
]


# A range wider than this is bad data, not a plan. `easter_sunday` is only exact
# for 1583-4099 anyway, so building a century of calendars past the end of a real
# project buys nothing and costs a year of arithmetic per iteration. The callers
# that could reach here with a silly range now clamp their dates too
# (`_parse_date`); this is the second lock on the same door.
MAX_SPAN_YEARS = 120


def holidays_for(country, start, end):
    """{date: name} for one country over an inclusive date range.

    An unknown country returns nothing rather than raising: a profile carrying a
    country this table does not cover must cost that person their holidays, not
    the whole reflow.
    """
    build = BUILDERS.get((country or DEFAULT_COUNTRY).upper())
    if not build or not start or not end:
        return {}
    out = {}
    last_year = min(end.year, start.year + MAX_SPAN_YEARS)
    for year in range(start.year, last_year + 1):
        for day, name in build(year).items():
            if start <= day <= end:
                out[day] = name
    return out
