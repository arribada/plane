# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Auto-schedule leaves finished work where it happened.

The reflow pushed every row whose link was violated, and a completed or
cancelled item is a row like any other to a forward pass that reads only dates.
So a bench test done in March, linked after a design task that later slipped to
May, was re-dated to June — and the funder report, which reads these dates,
said the test had not happened yet. Dates reach funders.

`test_scheduling.py` proves the engine's `fixed` parameter. This is the endpoint:
the finished ids are found from the state group, handed to the engine, and never
written — while the work that waits on a finished item still cascades from the
dates it really ran on.

Run explicitly: `python -m pytest plane/arribada/test_auto_schedule_finished.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.db.models import Issue, IssueRelation, State

D = date


def _item(world, name, start, target, state=None):
    return Issue.objects.create(
        name=name,
        project=world["project"],
        workspace=world["workspace"],
        state=state or world["state"],
        start_date=start,
        target_date=target,
        created_by=world["users"]["owner"],
    )


def _after(world, successor, predecessor):
    IssueRelation.objects.create(
        issue=successor,
        related_issue=predecessor,
        relation_type="blocked_by",
        project=world["project"],
        workspace=world["workspace"],
    )


def _reflow(world):
    url = reverse(
        "arribada-project-auto-schedule",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"]["member"].post(url, {}, format="json")
    assert response.status_code == 200, response.data
    return response.data


@pytest.fixture
def chain(money_project):
    """A 3–7 Aug, then B 5–7 Aug (violates), then C 6–10 Aug (violates B).

    Movable throughout, the reflow puts B on 10–12 Aug and C on the 13th.
    """
    world = money_project
    a = _item(world, "Design", D(2026, 8, 3), D(2026, 8, 7))
    b = _item(world, "Bench test", D(2026, 8, 5), D(2026, 8, 7))
    c = _item(world, "Report", D(2026, 8, 6), D(2026, 8, 10))
    _after(world, b, a)
    _after(world, c, b)
    return {**world, "a": a, "b": b, "c": c}


def test_the_fixture_moves_when_nothing_is_finished(chain):
    """The control, so the next test proves the state group and not the fixture."""
    moved = {m["issue_id"] for m in _reflow(chain)["issues"]}
    assert moved == {str(chain["b"].id), str(chain["c"].id)}
    chain["b"].refresh_from_db()
    assert chain["b"].start_date == D(2026, 8, 10)


def test_a_completed_item_is_not_re_dated_and_still_constrains_its_successor(chain):
    """B is done. It stays on 5–7 Aug, and C cascades from B's REAL finish on
    the 7th — not from where B would have been pushed to."""
    Issue.objects.filter(id=chain["b"].id).update(state=chain["done_state"])

    result = _reflow(chain)

    moved = {m["issue_id"] for m in result["issues"]}
    assert str(chain["b"].id) not in moved, "a completed work item was re-dated by the reflow"
    assert moved == {str(chain["c"].id)}

    chain["b"].refresh_from_db()
    assert (chain["b"].start_date, chain["b"].target_date) == (D(2026, 8, 5), D(2026, 8, 7))
    chain["c"].refresh_from_db()
    assert (chain["c"].start_date, chain["c"].target_date) == (D(2026, 8, 10), D(2026, 8, 12))


def test_a_cancelled_item_is_fixed_too(chain):
    cancelled = State.objects.create(
        name="Cancelled",
        project=chain["project"],
        workspace=chain["workspace"],
        group="cancelled",
        sequence=3,
    )
    Issue.objects.filter(id=chain["b"].id).update(state=cancelled)

    moved = {m["issue_id"] for m in _reflow(chain)["issues"]}

    assert str(chain["b"].id) not in moved
    chain["b"].refresh_from_db()
    assert chain["b"].start_date == D(2026, 8, 5)
