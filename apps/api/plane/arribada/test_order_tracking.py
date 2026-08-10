# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What happens to a purchase after the money decision — and the schedule that
was waiting on it.

`service.trackPurchase` had zero call sites. The backend PATCH, the four model
fields, the `ordered`/`received` statuses and the migrations that carried them all
existed; only the control was missing. Three things followed from that, and this
file pins all three at the layer they live in:

* An approved purchase could never be marked ordered or received, so those two
  states were unreachable through the product.
* The audit list drew both of them as **"Rejected", in red** — a two-way ternary
  whose else-branch absorbed every state it had not been told about. That half is
  pinned in the web suite (`helpers.test.ts`), where the rendering lives.
* "Let the schedule wait for deliveries" could not do anything. Auto-schedule
  builds its floors from `expected_on`/`received_on`, which nothing could write, so
  `delivery_constrained` was always 0 while the toggle's help text described a rule
  the product could not keep. That is the last test here, deliberately end to end
  through the two endpoints rather than against `cascade` — `test_delivery_floors.py`
  already proves the arithmetic, and the arithmetic was never the broken part.

Run explicitly: `python -m pytest plane/arribada/test_order_tracking.py`
"""

from datetime import date, timedelta

import pytest
from django.urls import reverse

from plane.arribada.models import ProcurementRequest, ProjectSchedule, ProjectTeamMember
from plane.db.models import Issue


@pytest.fixture
def approved(money_project):
    """An approved purchase attached to a work item, which is the only shape a
    delivery floor can apply to."""
    ProjectTeamMember.objects.create(
        project=money_project["project"],
        name="Lead",
        email="lead@arribada.test",
        member=money_project["users"]["lead"],
        is_lead=True,
    )
    issue = Issue.objects.create(
        name="Fit the boards",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        start_date=date(2027, 3, 1),
        target_date=date(2027, 3, 5),
    )
    row = ProcurementRequest.objects.create(
        project=money_project["project"],
        requested_by=money_project["users"]["member"],
        label="10 Linkit boards",
        amount=250,
        quantity=10,
        currency="GBP",
        status=ProcurementRequest.APPROVED,
        issue=issue,
    )
    return {**money_project, "request": row, "issue": issue}


def track_url(world):
    return reverse(
        "arribada-project-procurement-decision",
        kwargs={
            "slug": world["slug"],
            "project_id": world["project_id"],
            "request_id": str(world["request"].id),
        },
    )


def schedule_url(world):
    return reverse(
        "arribada-project-auto-schedule",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


# --- the states the product could not reach ----------------------------------


def test_an_approved_purchase_can_be_marked_ordered(approved):
    response = approved["clients"]["member"].patch(
        track_url(approved),
        {"status": "ordered", "order_reference": "PO-2026-014", "ordered_on": "2027-03-02"},
        format="json",
    )
    assert response.status_code == 200
    approved["request"].refresh_from_db()
    assert approved["request"].status == ProcurementRequest.ORDERED
    assert approved["request"].order_reference == "PO-2026-014"
    assert approved["request"].ordered_on == date(2027, 3, 2)


def test_an_ordered_purchase_can_be_marked_received(approved):
    client = approved["clients"]["member"]
    client.patch(track_url(approved), {"status": "ordered", "ordered_on": "2027-03-02"}, format="json")
    response = client.patch(
        track_url(approved), {"status": "received", "received_on": "2027-03-20"}, format="json"
    )
    assert response.status_code == 200
    approved["request"].refresh_from_db()
    assert approved["request"].status == ProcurementRequest.RECEIVED
    assert approved["request"].received_on == date(2027, 3, 20)


def test_tracking_never_touches_the_money(approved):
    """The PATCH is bookkeeping and is open to any project member; approving spends
    and is the lead's. A test proving only that the fields are writable would also
    pass on an endpoint that let a member re-price the line."""
    response = approved["clients"]["member"].patch(
        track_url(approved),
        {"status": "ordered", "amount": 99999, "quantity": 1, "currency": "XXX"},
        format="json",
    )
    assert response.status_code == 200
    approved["request"].refresh_from_db()
    assert float(approved["request"].amount) == 250
    assert float(approved["request"].quantity) == 10
    assert approved["request"].currency == "GBP"


def test_a_rejected_request_has_no_order_to_track(approved):
    approved["request"].status = ProcurementRequest.REJECTED
    approved["request"].save()
    response = approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "ordered_on": "2027-03-02"}, format="json"
    )
    assert response.status_code == 400
    approved["request"].refresh_from_db()
    assert approved["request"].status == ProcurementRequest.REJECTED


def test_tracking_cannot_be_used_to_approve(approved):
    """The two verbs stay on two endpoints. Approving is what writes the expense
    line, so a PATCH that could set `approved` from `pending` would be a way to
    commit money without the lead and without a line."""
    approved["request"].status = ProcurementRequest.PENDING
    approved["request"].save()
    response = approved["clients"]["member"].patch(
        track_url(approved), {"status": "approved"}, format="json"
    )
    assert response.status_code == 400
    approved["request"].refresh_from_db()
    assert approved["request"].status == ProcurementRequest.PENDING


# --- the toggle that could never do anything ---------------------------------


def test_the_delivery_floor_does_nothing_until_the_project_asks_for_it(approved):
    """Off by default and per project. Recording a delivery is bookkeeping; moving
    somebody's dates because a colleague typed a supplier's promise into a form is
    a different act, and it needs consent."""
    approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "expected_on": "2027-04-12"}, format="json"
    )
    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")

    assert response.status_code == 200
    assert response.data["delivery_constrained"] == 0
    approved["issue"].refresh_from_db()
    assert approved["issue"].start_date == date(2027, 3, 1)


def test_a_tracked_delivery_actually_moves_the_plan(approved):
    """End to end, through the two endpoints a person uses, because every piece of
    this existed and worked except the one that writes the date — so every test
    below the endpoints was green while `delivery_constrained` was permanently 0."""
    ProjectSchedule.objects.update_or_create(
        project=approved["project"], defaults={"schedule_from_deliveries": True}
    )
    tracked = approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "expected_on": "2027-04-12"}, format="json"
    )
    assert tracked.status_code == 200

    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")
    assert response.status_code == 200
    assert response.data["delivery_constrained"] == 1, "the floor never reached the scheduler"

    approved["issue"].refresh_from_db()
    # 2027-04-12 is a Monday, so the floor applies as given and the four-day
    # duration is preserved.
    assert approved["issue"].start_date == date(2027, 4, 12)
    assert approved["issue"].target_date == date(2027, 4, 16)


def test_the_date_the_parts_arrived_wins_over_the_one_the_supplier_promised(approved):
    """Once the boards are on the bench, what the supplier said is history. This is
    the rule the endpoint's docstring states; nothing tested it above the level of
    `cascade` because nothing could write either date."""
    ProjectSchedule.objects.update_or_create(
        project=approved["project"], defaults={"schedule_from_deliveries": True}
    )
    approved["clients"]["member"].patch(
        track_url(approved),
        {"status": "received", "expected_on": "2027-04-12", "received_on": "2027-03-22"},
        format="json",
    )

    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")
    assert response.status_code == 200
    approved["issue"].refresh_from_db()
    # The Monday it actually arrived, not the April promise.
    assert approved["issue"].start_date == date(2027, 3, 22)


def test_a_delivery_with_no_dates_constrains_nothing(approved):
    """`ordered` with no dates is a legitimate state — the order is placed and the
    supplier has not said when. It must not be read as a floor of "now"."""
    ProjectSchedule.objects.update_or_create(
        project=approved["project"], defaults={"schedule_from_deliveries": True}
    )
    approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "ordered_on": "2027-03-02"}, format="json"
    )

    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")
    assert response.status_code == 200
    assert response.data["delivery_constrained"] == 0
    approved["issue"].refresh_from_db()
    assert approved["issue"].start_date == date(2027, 3, 1)


def test_a_purchase_attached_to_no_work_item_moves_nothing(approved):
    """Most purchases are consumables. A floor with no issue behind it has nothing
    to hold, and must not become a floor on the whole project."""
    ProjectSchedule.objects.update_or_create(
        project=approved["project"], defaults={"schedule_from_deliveries": True}
    )
    approved["request"].issue = None
    approved["request"].save()
    approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "expected_on": "2027-04-12"}, format="json"
    )

    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")
    assert response.status_code == 200
    assert response.data["delivery_constrained"] == 0


def test_the_tracked_dates_come_back_on_the_read(approved):
    """The list the control renders from. A field written and not serialised is a
    field the form reopens empty, which reads as "it did not save"."""
    approved["clients"]["member"].patch(
        track_url(approved),
        {
            "status": "ordered",
            "order_reference": "PO-2026-014",
            "ordered_on": "2027-03-02",
            "expected_on": "2027-04-12",
        },
        format="json",
    )
    listing = approved["clients"]["member"].get(
        reverse(
            "arribada-project-procurement",
            kwargs={"slug": approved["slug"], "project_id": approved["project_id"]},
        )
    )
    assert listing.status_code == 200
    row = next(r for r in listing.data["requests"] if r["id"] == str(approved["request"].id))
    assert row["status"] == "ordered"
    assert row["order_reference"] == "PO-2026-014"
    assert row["ordered_on"] == "2027-03-02"
    assert row["expected_on"] == "2027-04-12"
    assert row["received_on"] is None


def test_a_far_future_delivery_is_still_only_a_date(approved):
    """The date bomb's neighbourhood: a floor years out must schedule, not raise.
    Cheap to assert and the failure mode is a 500 on somebody's reflow."""
    ProjectSchedule.objects.update_or_create(
        project=approved["project"], defaults={"schedule_from_deliveries": True}
    )
    far = date.today() + timedelta(days=365 * 6)
    approved["clients"]["member"].patch(
        track_url(approved), {"status": "ordered", "expected_on": far.isoformat()}, format="json"
    )
    response = approved["clients"]["member"].post(schedule_url(approved), {}, format="json")
    assert response.status_code == 200
