# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The activated-timezone leak, demonstrated and then shown to be closed.

This file exists because a defect was misdiagnosed in this repo for weeks. The
handover called `test_capacity_part_time.py::test_a_fully_booked_full_timer_
reads_one_hundred_percent` "time-of-day sensitive", which is a description of
the symptom and not of the cause, and the file it lives in says in capitals that
its numbers cannot depend on when the suite runs. Both statements are true in
isolation and the combination made the real mechanism invisible.

THE MECHANISM. `TimezoneMixin.initial` — inherited by every view in this app
through `BaseAPIView` — calls `django.utils.timezone.activate()` with the
caller's zone, and calls `deactivate()` only for an ANONYMOUS caller. `activate`
writes a thread-local that outlives the request. `test_caller_day.py` puts a
user in `Pacific/Auckland` and drives requests through that mixin, so from then
on every test in the same process computes `timezone.localdate()` in Auckland —
which from 12:00 UTC onwards is already TOMORROW.

That produces exactly the two observed behaviours, which no "flaky test" story
accounts for together:

  - the file PASSES when run alone, at any hour, because nothing activated
    Auckland; and
  - it FAILS in the full suite, but only after noon UTC, because that is when
    the leaked zone and UTC stop agreeing about what day it is.

The two tests below run in definition order within this file, which is what
makes the pair deterministic: the first leaks a zone on purpose, the autouse
fixture in `conftest.py` cleans up after it, and the second proves the cleanup
happened. Delete the fixture and the second test fails.
"""

from datetime import date
from zoneinfo import ZoneInfo

from django.utils import timezone
from freezegun import freeze_time

# 23:00 UTC is 11:00 the NEXT day in Auckland (UTC+12). Any instant after noon
# UTC would do; this one is unambiguous and does not sit on a DST boundary.
LATE_UTC = "2026-09-14 23:00:00"
UTC_DAY = date(2026, 9, 14)
AUCKLAND_DAY = date(2026, 9, 15)
AUCKLAND = "Pacific/Auckland"


def test_an_activated_zone_moves_what_localdate_calls_today():
    """The defect itself, reproduced in four lines and left activated on purpose.

    `timezone.activate` is what `TimezoneMixin` calls on every authenticated
    request, and nothing in this test undoes it — exactly as nothing in
    `test_caller_day.py` undoes it. The autouse fixture is what cleans up, and
    the next test is what proves it did.
    """
    with freeze_time(LATE_UTC):
        assert timezone.localdate() == UTC_DAY

        timezone.activate(ZoneInfo(AUCKLAND))

        # Same instant, same process, different answer to "what day is it".
        # A fixture that builds dates here and an endpoint that recomputes them
        # under a different zone are one day apart, which is one working day in
        # forty — the `98 == 100` in test_capacity_part_time.py.
        assert timezone.localdate() == AUCKLAND_DAY


def test_the_next_test_does_not_inherit_it():
    """The fix. Without the autouse `_no_leaked_timezone` fixture in
    `conftest.py`, this fails — it would still be in Auckland, and so would
    every other test that ran after the one above."""
    with freeze_time(LATE_UTC):
        assert timezone.localdate() == UTC_DAY
    assert timezone.get_current_timezone_name() != AUCKLAND


def test_the_real_caller_day_test_leaks_through_the_mixin(db):
    """Not a hypothetical: the leak arrives through a real request.

    Drives `TimezoneMixin` the way `test_caller_day.py` does — an authenticated
    user whose `user_timezone` is Auckland — and shows the zone is still active
    once the response has been returned. This is the step that makes the
    mechanism a fact about the product rather than about `activate()`.
    """
    from rest_framework.test import APIClient

    from plane.app.permissions import ROLE
    from plane.db.models import User, Workspace, WorkspaceMember

    user = User.objects.create(
        email="tz@arribada.test", username="tz-leak", first_name="Tz", user_timezone=AUCKLAND
    )
    workspace = Workspace.objects.create(name="Tz", owner=user, slug="tz-leak")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=ROLE.ADMIN.value)

    client = APIClient()
    client.force_authenticate(user=user)
    # Any view on BaseAPIView will do; this one needs no project.
    response = client.get(f"/api/arribada/workspaces/{workspace.slug}/my-work/")
    assert response.status_code == 200, response.content

    # The request is over and the zone is still activated. THAT is the leak.
    assert timezone.get_current_timezone_name() == AUCKLAND
