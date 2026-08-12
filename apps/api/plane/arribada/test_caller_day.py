# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A plan date is a plain day, and the day belongs to whoever is reading it.

`TimezoneMixin` — which every endpoint in `views.py` inherits through
`BaseAPIView` — activates the caller's own timezone on each request.
`timezone.localdate()` honours that; `timezone.now().date()` throws it away and
answers the server's UTC day, which is a different day for a third of every day
for everybody who does not live on the Greenwich meridian.

Sixteen places in `views.py` asked for "today" and fifteen of them meant the
caller's. This file pins three of the fifteen and the one exception, at the
instant where the two answers differ:

    22:00 UTC on 1 March 2026  ==  11:00 on 2 March in Auckland

A start date, a target date, a rate-capture date and a baseline's name are not
timestamps. They are statements about a square on a calendar that a human is
looking at, and the only calendar that exists is theirs. Two of the four cases
below WRITE that day to the database, which is what makes this a data question
rather than a display one.

`timezone.now` is what moves, not `localdate` — so the wiring under test
(mixin activates a zone, `localdate` reads it) actually runs. `freezegun` is
pinned in `requirements/test.txt` but is NOT installed in the image the CI job
runs this suite in; importing it here would take the whole suite out at
collection.

Run explicitly: `python -m pytest plane/arribada/test_caller_day.py`
"""

from datetime import date, datetime, timezone as dt_timezone

import pytest
from django.urls import reverse
from django.utils import timezone as dj_timezone

from plane.arribada import views
from plane.arribada.models import ProjectBaseline
from plane.db.models import Issue, IssueAssignee, User

AUCKLAND = "Pacific/Auckland"
# Late enough in the UTC evening that Auckland is already on the next day.
LATE_ON_THE_FIRST = datetime(2026, 3, 1, 22, 0, tzinfo=dt_timezone.utc)
SERVER_DAY = date(2026, 3, 1)
CALLER_DAY = date(2026, 3, 2)


@pytest.fixture
def in_auckland(money_project, monkeypatch):
    """Every caller thirteen hours ahead, at an instant where that is another day.

    The timezone is set through `.update()` and mirrored onto the in-memory
    objects: those are the exact instances `force_authenticate` hands back as
    `request.user`, which is where `TimezoneMixin` reads it from.
    """
    for user in money_project["users"].values():
        User.objects.filter(id=user.id).update(user_timezone=AUCKLAND)
        user.user_timezone = AUCKLAND
    monkeypatch.setattr(views.timezone, "now", lambda: LATE_ON_THE_FIRST)
    return money_project


def test_the_undated_gap_suggests_the_callers_day_not_the_servers(in_auckland):
    """The bulk "date everything" button, which writes what it suggests.

    A lead in Auckland opening this at 11am on Monday was offered Sunday, and the
    POST beside it then wrote Sunday onto real work items — a start date in the
    past, on a day nobody works, planted by the feature whose whole purpose is to
    clean up dates.
    """
    Issue.objects.create(
        name="Order the enclosures",
        project=in_auckland["project"],
        workspace=in_auckland["workspace"],
        state=in_auckland["state"],
        created_by=in_auckland["users"]["owner"],
    )
    url = reverse(
        "arribada-project-undated-gap",
        kwargs={"slug": in_auckland["slug"], "project_id": in_auckland["project_id"]},
    )
    response = in_auckland["clients"]["owner"].get(url)
    assert response.status_code == 200, response.data

    assert response.data["items"][0]["suggested_start"] == CALLER_DAY.isoformat()
    assert response.data["items"][0]["suggested_start"] != SERVER_DAY.isoformat()


def test_a_baseline_captured_after_midnight_is_named_for_the_callers_day(in_auckland):
    """A snapshot named "Baseline 1 March" that was taken on the 2nd is a snapshot
    nobody can line up against anything else in the project."""
    url = reverse(
        "arribada-project-baseline",
        args=[in_auckland["slug"], in_auckland["project_id"]],
    )
    response = in_auckland["clients"]["owner"].post(url, {}, format="json")
    assert response.status_code == 201, response.data

    assert response.data["name"] == f"Baseline {CALLER_DAY.isoformat()}"
    assert ProjectBaseline.objects.get(id=response.data["id"]).name.endswith("2026-03-02")


def test_overdue_is_counted_against_the_callers_day(in_auckland):
    """Work due on the 1st is late once it is the 2nd where you are standing.

    The workload board is read at a stand-up, which is the moment somebody's
    morning and the server's yesterday are furthest apart.
    """
    issue = Issue.objects.create(
        name="Ship the firmware",
        project=in_auckland["project"],
        workspace=in_auckland["workspace"],
        state=in_auckland["state"],
        created_by=in_auckland["users"]["owner"],
        target_date=SERVER_DAY,
    )
    IssueAssignee.objects.create(
        issue=issue,
        assignee=in_auckland["users"]["member"],
        project=in_auckland["project"],
        workspace=in_auckland["workspace"],
    )

    url = reverse("arribada-workload", kwargs={"slug": in_auckland["slug"]})
    response = in_auckland["clients"]["owner"].get(url)
    assert response.status_code == 200, response.data

    rows = {row["user_id"]: row for row in response.data}
    assert rows[str(in_auckland["users"]["member"].id)]["overdue"] == 1


def test_the_plan_date_ceiling_does_not_move_with_the_caller(in_auckland, monkeypatch):
    """The one deliberate exception, pinned so nobody "fixes" it later.

    `_plan_date_ceiling` is a validation bound, not somebody's today, and a bound
    has to give every caller the same answer. On `localdate()` two people either
    side of midnight on 31 December would disagree by a WHOLE YEAR about whether a
    date is plantable — the same request accepted from Auckland and refused from
    London, an hour apart, for reasons neither of them could see.
    """
    monkeypatch.setattr(
        views.timezone, "now", lambda: datetime(2026, 12, 31, 22, 0, tzinfo=dt_timezone.utc)
    )
    with dj_timezone.override(AUCKLAND):
        # The caller's day really has rolled over into the next year...
        assert dj_timezone.localdate() == date(2027, 1, 1)
        # ...and the ceiling has not moved with it.
        assert views._plan_date_ceiling() == date(2076, 12, 31)
    with dj_timezone.override("UTC"):
        assert views._plan_date_ceiling() == date(2076, 12, 31)
