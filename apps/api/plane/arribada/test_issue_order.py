# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The contract between the gantt's drag and the order endpoints.

The timeline can now be dragged while it is SORTED by something else and while it
is GROUPED into bands. Both work the same way: the arrangement in front of the
reader is written down as the manual order first — the "freeze" — and the drop is
then applied to that. Which means the client is no longer a passive caller of
these endpoints. It computes the sort_order for the row it just moved from the
numbers the freeze wrote, because its own store still holds the ones from before
the call, and a midpoint taken between two stale numbers puts the row somewhere
nobody dropped it.

So `(index + 1) * ORDER_STEP` is not an implementation detail any more; it is a
published shape, and `apps/web/ce/components/gantt-chart/reorder.ts` reproduces
it. The first two tests exist to fail if either side moves.

The rest is what a drag-after-grouping must not break: a saved arrangement is a
snapshot, and freezing has to leave every one of them exactly as it was, however
many times somebody drags.

Run explicitly: `python -m pytest plane/arribada/test_issue_order.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.models import ProjectIssueOrder
from plane.arribada.views import ORDER_CAP, ORDER_STEP
from plane.db.models import Issue

MONDAY = date(2026, 8, 3)
FRIDAY = date(2026, 8, 7)


def _items(world, count):
    """`count` work items, deliberately all with the same sort_order.

    Plane's default is 65535 for everything, so the sequence a freeze produces is
    never a re-statement of an order the rows already had.
    """
    return [
        Issue.objects.create(
            name=f"Item {n}",
            project=world["project"],
            workspace=world["workspace"],
            state=world["state"],
            start_date=MONDAY,
            target_date=FRIDAY,
            sort_order=65535,
            created_by=world["users"]["owner"],
        )
        for n in range(count)
    ]


def _apply_url(world):
    return reverse(
        "arribada-project-order-apply",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


def _orders_url(world):
    return reverse(
        "arribada-project-orders",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


@pytest.mark.django_db
def test_freezing_writes_index_plus_one_times_the_step(money_project):
    """The exact numbers the client reproduces to place the row it just dropped."""
    world = money_project
    items = _items(world, 4)
    # Deliberately not the creation order: the point of a freeze is that the
    # sequence ON SCREEN wins, whatever produced it.
    sequence = [items[2], items[0], items[3], items[1]]

    response = world["clients"]["member"].post(
        _apply_url(world), {"issue_ids": [str(i.id) for i in sequence]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["applied"] == 4

    for index, issue in enumerate(sequence):
        issue.refresh_from_db()
        assert issue.sort_order == (index + 1) * ORDER_STEP, (
            f"row {index} of a frozen order must be ({index} + 1) * {ORDER_STEP}; the gantt's "
            "drop computes its midpoint from that number rather than from its own store"
        )


@pytest.mark.django_db
def test_the_step_is_the_one_the_client_hardcodes():
    """A guard rail, not a tautology.

    `ORDER_STEP` is duplicated in the web client, which cannot import it. If this
    number changes, that copy has to change in the same commit, and a test that
    names the value is the only thing that will say so.
    """
    assert ORDER_STEP == 1000


@pytest.mark.django_db
def test_a_freeze_leaves_every_saved_order_untouched(money_project):
    """Dragging must not rewrite an arrangement somebody chose to keep.

    A saved order is a snapshot of ids; freezing writes sort_order on the items.
    The two are deliberately different storage, and this is what makes a
    drag-after-grouping safe to do repeatedly.
    """
    world = money_project
    items = _items(world, 5)
    client = world["clients"]["member"]

    saved = client.post(
        _orders_url(world),
        {"name": "Funder review", "issue_ids": [str(i.id) for i in items]},
        format="json",
    )
    assert saved.status_code == 201, saved.data
    before = list(ProjectIssueOrder.objects.get(project=world["project"], name="Funder review").issue_ids)

    # Two drags in a row, each freezing a different arrangement — a grouped board
    # flattened, then a row moved inside the result.
    shuffled = [items[4], items[3], items[2], items[1], items[0]]
    for sequence in (shuffled, items):
        response = client.post(
            _apply_url(world), {"issue_ids": [str(i.id) for i in sequence]}, format="json"
        )
        assert response.status_code == 200, response.data

    row = ProjectIssueOrder.objects.get(project=world["project"], name="Funder review")
    assert list(row.issue_ids) == before, "freezing rewrote a saved arrangement"
    assert ProjectIssueOrder.objects.filter(project=world["project"]).count() == 1, (
        "freezing created a saved order of its own"
    )


@pytest.mark.django_db
def test_an_order_produced_by_a_drag_saves_and_restores_like_any_other(money_project):
    """The round trip a reader actually performs after dragging on a grouped board."""
    world = money_project
    items = _items(world, 4)
    client = world["clients"]["member"]
    # What the bands produced, flattened, with one row then dragged to the front.
    dragged = [items[3], items[0], items[1], items[2]]

    assert client.post(
        _apply_url(world), {"issue_ids": [str(i.id) for i in dragged]}, format="json"
    ).status_code == 200

    saved = client.post(_orders_url(world), {"name": "After the drag"}, format="json")
    assert saved.status_code == 201, saved.data
    # No issue_ids in that payload, so the server read its own sort_order — which
    # is the sequence the freeze just wrote.
    assert saved.data["count"] == 4

    # Scramble, then restore.
    client.post(
        _apply_url(world), {"issue_ids": [str(i.id) for i in reversed(dragged)]}, format="json"
    )
    order_id = str(ProjectIssueOrder.objects.get(project=world["project"], name="After the drag").id)
    restored = client.post(
        reverse(
            "arribada-project-order-detail",
            kwargs={"slug": world["slug"], "project_id": world["project_id"], "order_id": order_id},
        ),
        {},
        format="json",
    )
    assert restored.status_code == 200, restored.data

    back = list(
        Issue.objects.filter(project=world["project"]).order_by("sort_order").values_list("id", flat=True)
    )
    assert [str(i) for i in back] == [str(i.id) for i in dragged]


@pytest.mark.django_db
def test_saving_keeps_as_many_items_as_freezing_does(money_project):
    """The two halves of one feature agreed on 500 and 2000 respectively.

    Freezing capped at 2000 and saving at the `_uuid_keys` default of 500, so a
    board of 700 items froze all 700 and then saved the first 500 — reporting
    success, and a `count` that made the truncation look like the real length.
    Auto-paging pulls the whole project in as soon as the chart is grouped, so
    this is the ordinary case on a generated plan, not a pathological one.

    Six hundred ids, not two thousand: enough to be over the old cap and cheap
    enough to run every time.
    """
    world = money_project
    ids = [str(i.id) for i in _items(world, 600)]

    response = world["clients"]["member"].post(
        _orders_url(world), {"name": "Everything", "issue_ids": ids}, format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["count"] == 600, "the save silently dropped items it said it had kept"

    row = ProjectIssueOrder.objects.get(project=world["project"], name="Everything")
    assert list(row.issue_ids) == ids
    assert ORDER_CAP >= 2000
