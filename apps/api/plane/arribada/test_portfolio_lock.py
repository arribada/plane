# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The portfolio board has to know which plans are frozen.

Every bar on that board was draggable, locked projects included, and it could not
have been otherwise: the payload never said. A board spanning twenty projects
cannot ask twenty times, so the flag rides along with the row — the schedule is
already joined for the planned dates, so it costs nothing.

Two timelines that disagree about whether a plan is locked teach people to
distrust the lock, which is the one control here whose whole value is being
believed.

Run explicitly: `python -m pytest plane/arribada/test_portfolio_lock.py`
"""

from django.urls import reverse

from plane.arribada.models import ProjectSchedule


def portfolio_url(world):
    return reverse("arribada-portfolio", args=[world["slug"]])


def row_for(payload, project_id):
    return next(row for row in payload if row["id"] == str(project_id))


def test_a_project_with_no_schedule_row_reads_as_unlocked(money_project):
    payload = money_project["clients"]["owner"].get(portfolio_url(money_project)).json()
    assert row_for(payload, money_project["project_id"])["timeline_locked"] is False


def test_a_locked_plan_says_so_on_the_board(money_project):
    ProjectSchedule.objects.create(project_id=money_project["project_id"], timeline_locked=True)
    payload = money_project["clients"]["owner"].get(portfolio_url(money_project)).json()
    assert row_for(payload, money_project["project_id"])["timeline_locked"] is True


def test_unlocking_reaches_the_board(money_project):
    schedule = ProjectSchedule.objects.create(
        project_id=money_project["project_id"], timeline_locked=True
    )
    schedule.timeline_locked = False
    schedule.save(update_fields=["timeline_locked"])
    payload = money_project["clients"]["owner"].get(portfolio_url(money_project)).json()
    assert row_for(payload, money_project["project_id"])["timeline_locked"] is False
