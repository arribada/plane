# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The workspace calendar used to 500 for the whole of 29 February.

    today.replace(year=today.year - 1)

is correct on 1,460 days out of 1,461. On the leap day it raises `ValueError: day
is out of range for month`, because 29 February 2027 does not exist — and the
exception escapes into a plain 500 on `/calendar/`, for every member of every
workspace, all day, next on 29 February 2028 and every four years after that.

Nothing about it is visible in review: the line reads like arithmetic and the
suite is green 1,460 days a year. It is the same family as the date bomb — a
calendar walk that is right until the calendar disagrees — and it is on a page
whose only job is to know what the calendar does.

The fix builds the range from whole years instead of shifting a day, which cannot
raise at all rather than raising less often. `holidays_for` already iterates a
year at a time and trims to the range, so January-to-December bounds are the
shape it wants; the couple of extra days at each end are days the chart is glad
to draw.

HOW TODAY IS MOVED. `timezone.now` is swapped for the instant under test, not
`localdate` — so the endpoint's own `timezone.localdate()` runs for real and this
file also pins that the two are wired together. `freezegun` is pinned in
`requirements/test.txt` but is NOT installed in the image the CI job runs the
suite in, which installs pytest and pytest-django and nothing else; importing it
here would take the whole suite out at collection.

Run explicitly: `python -m pytest plane/arribada/test_calendar_leap_day.py`
"""

from datetime import date, datetime, timezone as dt_timezone

import pytest
from django.urls import reverse

from plane.arribada import views
from plane.arribada.models import WorkspaceNonWorkingDay

# 29 February 2028: the next one, and the one this code would have met first.
LEAP_DAY = datetime(2028, 2, 29, 12, 0, tzinfo=dt_timezone.utc)
# An ordinary day, for the control.
ORDINARY_DAY = datetime(2027, 6, 15, 12, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def on_day(monkeypatch):
    """Run the request as if it were a given instant."""

    def move_to(instant):
        monkeypatch.setattr(views.timezone, "now", lambda: instant)

    return move_to


def calendar(world, caller="owner", **params):
    url = reverse("arribada-workspace-calendar", kwargs={"slug": world["slug"]})
    response = world["clients"][caller].get(url, params)
    assert response.status_code == 200, response.data
    return response.data


def statutory_dates(payload):
    return [row["date"] for row in payload["statutory"]]


def test_the_calendar_survives_the_twenty_ninth_of_february(money_project, on_day):
    """THE regression: this raised ValueError before, and answered 500.

    Asserted on real content and not merely on the status code — an endpoint that
    stopped raising by returning an empty list would be a different bug wearing
    the same green tick.
    """
    on_day(LEAP_DAY)
    payload = calendar(money_project)

    days = statutory_dates(payload)
    # 2028's own bank holidays, which is the year a reader on that day is looking
    # at. New Year's Day 2028 is a Saturday, so the substitute is Monday the 3rd.
    assert "2028-01-03" in days
    assert "2028-12-25" in days
    assert "2028-08-28" in days


def test_the_window_is_whole_years_around_today(money_project, on_day):
    """One year back and two forward, snapped to year boundaries.

    Pinned at both ends, because "cannot raise" is satisfied by a range of one day
    just as well as by the right one.
    """
    on_day(LEAP_DAY)
    days = statutory_dates(calendar(money_project))

    assert days == sorted(days)
    assert days[0] == "2027-01-01"
    assert days[-1] == "2030-12-26"


def test_an_ordinary_day_gets_the_same_shape_of_window(money_project, on_day):
    """The control: nothing about the fix is special-cased to a leap day."""
    on_day(ORDINARY_DAY)
    days = statutory_dates(calendar(money_project))

    assert days[0] == "2026-01-01"
    assert days[-1] == "2029-12-26"


def test_the_other_country_is_still_reachable_on_a_leap_day(money_project, on_day):
    """`?country=` is the parameter the whole endpoint exists to answer twice.

    France has no substitution rule, so its 2028 New Year is the 1st and not the
    3rd — which is also the cheapest possible proof that the country reached the
    holiday table rather than being ignored.
    """
    on_day(LEAP_DAY)
    payload = calendar(money_project, country="FR")

    assert payload["country"] == "FR"
    days = statutory_dates(payload)
    assert "2028-01-01" in days
    assert "2028-07-14" in days
    assert "2028-01-03" not in days


def test_the_hand_entered_closures_still_come_back(money_project, on_day):
    """The other half of the payload, which has no year window at all.

    A workspace closure is a decision somebody typed and it is returned whenever
    it falls, including on a leap day.
    """
    WorkspaceNonWorkingDay.objects.create(
        workspace=money_project["workspace"], date=date(2028, 2, 29), name="Team offsite"
    )
    on_day(LEAP_DAY)
    payload = calendar(money_project)

    assert [(d["date"], d["name"]) for d in payload["days"]] == [("2028-02-29", "Team offsite")]
