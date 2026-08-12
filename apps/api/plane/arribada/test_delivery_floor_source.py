# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Where the delivery floors come from, and who is allowed to see them.

`test_delivery_floors.py` proves the arithmetic — `cascade` takes floors and
respects them. This proves the other half, which was inlined in one endpoint and
therefore reachable by exactly one feature: a drag that pushes a dependency chain
has to stop at the same date the auto-schedule button stops at, or the two halves
of the planner disagree about whether a delivery is a constraint. Lifting it into
`_delivery_floors` and sending it with the graph is what makes that possible, so
both properties are pinned here.

The one that matters most is still the opt-in: a floor must do NOTHING unless the
project asked for it.

Run explicitly: `python -m pytest plane/arribada/test_delivery_floor_source.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.models import ProcurementRequest, ProjectSchedule
from plane.arribada.views import _delivery_floors
from plane.db.models import Issue


@pytest.fixture
def waiting(money_project):
    """A work item with an approved purchase attached, which is the only shape a
    delivery floor can apply to."""
    issue = Issue.objects.create(
        name="Fit the boards",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        start_date=date(2027, 3, 1),
        target_date=date(2027, 3, 5),
    )
    return {**money_project, "issue": issue}


def purchase(world, **kwargs):
    return ProcurementRequest.objects.create(
        project=world["project"],
        requested_by=world["users"]["member"],
        label=kwargs.pop("label", "10 Linkit boards"),
        amount=250,
        quantity=10,
        currency="GBP",
        issue=world["issue"],
        **kwargs,
    )


def test_no_floors_unless_the_project_asked(waiting):
    """The decision about trust, not the arithmetic. A planner that moved
    somebody's dates because a colleague typed a supplier's promise into a
    purchase form is a planner nobody uses twice."""
    purchase(waiting, status=ProcurementRequest.APPROVED, expected_on=date(2027, 6, 1))
    assert _delivery_floors(waiting["project_id"]) == {}

    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=False)
    assert _delivery_floors(waiting["project_id"]) == {}


def test_an_expected_delivery_becomes_a_floor_once_asked_for(waiting):
    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=True)
    purchase(waiting, status=ProcurementRequest.APPROVED, expected_on=date(2027, 6, 1))
    assert _delivery_floors(waiting["project_id"]) == {str(waiting["issue"].id): date(2027, 6, 1)}


def test_the_later_of_two_parts_is_what_the_task_waits_for(waiting):
    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=True)
    purchase(waiting, status=ProcurementRequest.APPROVED, expected_on=date(2027, 6, 1))
    purchase(waiting, label="Antennas", status=ProcurementRequest.ORDERED, expected_on=date(2027, 7, 15))
    assert _delivery_floors(waiting["project_id"]) == {str(waiting["issue"].id): date(2027, 7, 15)}


def test_what_arrived_beats_what_was_promised(waiting):
    """Once the parts are on the bench, the supplier's promise is history."""
    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=True)
    purchase(
        waiting,
        status=ProcurementRequest.RECEIVED,
        expected_on=date(2027, 6, 1),
        received_on=date(2027, 5, 20),
    )
    assert _delivery_floors(waiting["project_id"]) == {str(waiting["issue"].id): date(2027, 5, 20)}


def test_a_purchase_nobody_decided_on_is_not_a_constraint(waiting):
    """PENDING and REJECTED carry no promise anybody can plan against."""
    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=True)
    purchase(waiting, status=ProcurementRequest.PENDING, expected_on=date(2027, 6, 1))
    assert _delivery_floors(waiting["project_id"]) == {}


def test_the_graph_read_carries_the_floors_so_a_drag_can_respect_them(waiting):
    """The client that pushes a chain reads this endpoint already. Sending the
    floors with it is what stops a drag and the auto-schedule button disagreeing
    about the same delivery."""
    ProjectSchedule.objects.create(project_id=waiting["project_id"], schedule_from_deliveries=True)
    purchase(waiting, status=ProcurementRequest.APPROVED, expected_on=date(2027, 6, 1))

    url = reverse("arribada-project-critical-path", args=[waiting["slug"], waiting["project_id"]])
    payload = waiting["clients"]["owner"].get(url).json()
    assert payload["delivery_floors"] == {str(waiting["issue"].id): "2027-06-01"}


def test_a_project_that_never_asked_sends_an_empty_map_not_a_missing_key(waiting):
    """`{}` and absent mean different things to the client: absent is an old
    server, empty is "this project has no floors"."""
    url = reverse("arribada-project-critical-path", args=[waiting["slug"], waiting["project_id"]])
    payload = waiting["clients"]["owner"].get(url).json()
    assert payload["delivery_floors"] == {}
