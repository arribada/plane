# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Approving a purchase is the one click in this fork that spends money.

`ProjectProcurementDecisionEndpoint.post` read the request row OUTSIDE the
transaction it then opened, and the idempotency guard — "if this already has an
expense, reuse it" — tested that copy. Two clicks on Approve were two requests
that both saw an empty `expense_id`, both created a line, and the second
overwrote the pointer to the first. The project paid twice, and the survivor was
UNREACHABLE: reject and delete both clean up through that single pointer, so
nothing in the product could ever remove it.

The same stale read made Approve racing Reject worse than either alone. The
reject evaluated its own copy, found `expense_id` empty because the approve had
not committed yet, skipped the delete, and wrote the link to null — leaving a
REJECTED request that permanently cost the project money with nothing pointing at
the line.

`select_for_update` on the request, inside the transaction, is what makes the
second caller read what the first one did. The OneToOne on
`ProcurementRequest.expense` is the same invariant stated where the database can
hold it, and it stands even for a path that forgets the lock.

`select_for_update` appeared ZERO times in this fork before this file existed.

Run explicitly: `python -m pytest plane/arribada/test_procurement_money.py`
"""

import threading

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from plane.arribada.models import ProcurementRequest, ProjectExpense, ProjectTeamMember


@pytest.fixture
def with_lead(money_project):
    """The roster row that makes `lead` the project lead. Approving is lead-only."""
    ProjectTeamMember.objects.create(
        project=money_project["project"],
        name="Lead",
        email="lead@arribada.test",
        member=money_project["users"]["lead"],
        is_lead=True,
    )
    return money_project


@pytest.fixture
def pending(with_lead):
    return ProcurementRequest.objects.create(
        project=with_lead["project"],
        requested_by=with_lead["users"]["member"],
        label="10 Linkit boards",
        amount=250,
        quantity=10,
        currency="GBP",
    )


def decide_url(world, request_row):
    return reverse(
        "arribada-project-procurement-decision",
        kwargs={
            "slug": world["slug"],
            "project_id": world["project_id"],
            "request_id": str(request_row.id),
        },
    )


# --- the invariant, where the database can hold it ---------------------------


def test_one_expense_line_may_not_be_claimed_by_two_requests(with_lead):
    """`expense` was a plain ForeignKey, so nothing stopped it. It is a OneToOne
    now: one request, one line, stated where a race cannot get around it."""
    expense = ProjectExpense.objects.create(
        project=with_lead["project"], label="Boards", amount=250, currency="GBP"
    )
    ProcurementRequest.objects.create(
        project=with_lead["project"], label="A", amount=250, currency="GBP", expense=expense
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ProcurementRequest.objects.create(
                project=with_lead["project"], label="B", amount=250, currency="GBP", expense=expense
            )


def test_many_undecided_requests_may_all_have_no_line(with_lead):
    """Postgres allows many NULLs in a unique index, and the pending queue is
    mostly nulls. A test proving only the refusal above would also pass on a
    constraint that had broken the ordinary case."""
    for i in range(3):
        ProcurementRequest.objects.create(
            project=with_lead["project"], label=f"Request {i}", amount=1, currency="GBP"
        )
    assert ProcurementRequest.objects.filter(expense__isnull=True).count() == 3


# --- the decision is taken under a lock --------------------------------------


def test_the_decision_locks_the_request_it_is_deciding(with_lead, pending):
    """Behavioural rather than a source grep: the handler must issue a
    `SELECT ... FOR UPDATE` against the request table before it decides.

    Without it, everything below is correct only when nobody clicks twice.
    """
    url = decide_url(with_lead, pending)
    with CaptureQueriesContext(connection) as captured:
        response = with_lead["clients"]["lead"].post(url, {"decision": "approved"}, format="json")
    assert response.status_code == 200, response.data
    locking = [
        q["sql"]
        for q in captured.captured_queries
        if "FOR UPDATE" in q["sql"].upper() and "arribada_procurement_request" in q["sql"]
    ]
    assert locking, (
        "the approve handler took its idempotency decision without locking the request. "
        "Two clicks are then two transactions that both see no expense and both create one."
    )


# --- and the race it exists for ----------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_two_simultaneous_approvals_spend_once(django_db_setup, django_db_blocker):
    """The defect itself, driven with two real connections.

    A barrier makes both requests enter the handler together. With the lock the
    outcome is deterministic — the loser blocks, re-reads a committed
    `expense_id`, and reuses the line — so this cannot flake green once fixed.
    Without it, both create.
    """
    from rest_framework.test import APIClient

    from plane.app.permissions import ROLE
    from plane.db.models import Project, ProjectMember, State, User, Workspace, WorkspaceMember

    owner = User.objects.create(email="race@arribada.test", username="race-owner", first_name="R")
    workspace = Workspace.objects.create(name="Race", owner=owner, slug="race-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    project = Project.objects.create(name="Race", workspace=workspace, created_by=owner, identifier="RACE")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    ProjectTeamMember.objects.create(project=project, name="Owner", member=owner, is_lead=True)
    row = ProcurementRequest.objects.create(
        project=project, requested_by=owner, label="10 boards", amount=250, quantity=10, currency="GBP"
    )

    url = reverse(
        "arribada-project-procurement-decision",
        kwargs={"slug": workspace.slug, "project_id": str(project.id), "request_id": str(row.id)},
    )
    barrier = threading.Barrier(2, timeout=30)
    statuses = []

    def approve():
        from django.db import connections

        try:
            client = APIClient()
            client.force_authenticate(user=owner)
            barrier.wait()
            statuses.append(client.post(url, {"decision": "approved"}, format="json").status_code)
        finally:
            # A thread that leaves its connection open holds the row lock past the
            # end of the test and deadlocks the teardown.
            connections.close_all()

    threads = [threading.Thread(target=approve) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
        assert not thread.is_alive(), "an approval never returned — the lock is not being released"

    assert statuses == [200, 200], statuses
    lines = ProjectExpense.objects.filter(project=project)
    assert lines.count() == 1, (
        f"two simultaneous approvals wrote {lines.count()} expense lines. The project pays twice "
        "and the second line is unreachable — reject and delete both clean up via the request's "
        "single pointer."
    )
    row.refresh_from_db()
    assert str(row.expense_id) == str(lines.first().id)


# --- rejecting and withdrawing take the money back out -----------------------


def test_rejecting_after_approving_removes_the_line(with_lead, pending):
    url = decide_url(with_lead, pending)
    client = with_lead["clients"]["lead"]
    client.post(url, {"decision": "approved"}, format="json")
    assert ProjectExpense.objects.filter(project=with_lead["project"]).count() == 1

    rejected = client.post(url, {"decision": "rejected"}, format="json")
    assert rejected.status_code == 200
    assert ProjectExpense.objects.filter(project=with_lead["project"]).count() == 0
    assert rejected.data["expense_id"] is None


def test_withdrawing_an_approved_request_removes_its_line(with_lead, pending):
    client = with_lead["clients"]["lead"]
    url = decide_url(with_lead, pending)
    client.post(url, {"decision": "approved"}, format="json")
    assert client.delete(url).status_code == 200
    assert ProjectExpense.objects.filter(project=with_lead["project"]).count() == 0
    assert not ProcurementRequest.objects.filter(id=pending.id).exists()


def test_approving_the_same_request_twice_in_a_row_spends_once(with_lead, pending):
    """The sequential case, which the old guard did get right. Kept so a fix for
    the concurrent one cannot break it — an approve that errored on the second
    press would satisfy every other test here."""
    url = decide_url(with_lead, pending)
    client = with_lead["clients"]["lead"]
    assert client.post(url, {"decision": "approved"}, format="json").status_code == 200
    assert client.post(url, {"decision": "approved"}, format="json").status_code == 200
    assert ProjectExpense.objects.filter(project=with_lead["project"]).count() == 1


def test_only_the_lead_may_spend(with_lead, pending):
    response = with_lead["clients"]["member"].post(
        decide_url(with_lead, pending), {"decision": "approved"}, format="json"
    )
    assert response.status_code == 403
    assert ProjectExpense.objects.filter(project=with_lead["project"]).count() == 0
