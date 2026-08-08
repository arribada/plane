# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A work item has ONE discipline, and every reader has to agree which.

`IssueRole` was unique on `(issue, role)`. Several rows per item were therefore
legal, and nothing in the product could cope with that:

* the work-item panel took `.first()`, which under `Meta.ordering = ("role",)` is
  the alphabetically first;
* the budget built a dict keyed on the issue, so the alphabetically LAST won.

The panel showed one discipline and the budget charged the other's hourly rate.
The two numbers never appear on the same screen, so nobody could reconcile them.

Worse than the disagreement: four of the five writers use
`update_or_create(issue_id=...)`, a lookup on a key the database did not consider
unique. The moment an item held two, every one of them raised
`MultipleObjectsReturned` — a permanent 500 on that work item, and unfixable
through the UI, because the endpoint that would have cleared the extra row 500s
on the same query.

Plural was never modelled anyway: `_labour_cost` multiplies an item's whole
effort by one discipline's rate, and nothing records how a task's days would
split between two. So the choice was between one discipline and two costs.

Run explicitly: `python -m pytest plane/arribada/test_issue_discipline.py`
"""

import pytest
from django.db import IntegrityError, transaction
from django.urls import reverse

from plane.arribada.models import IssueRole, ProjectTeamMember
from plane.db.models import Issue


@pytest.fixture
def item(money_project):
    return Issue.objects.create(
        name="Radio bring-up",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        created_by=money_project["users"]["owner"],
    )


def role_url(world, issue):
    return reverse(
        "arribada-issue-role",
        kwargs={
            "slug": world["slug"],
            "project_id": world["project_id"],
            "issue_id": str(issue.id),
        },
    )


# --- the constraint ----------------------------------------------------------


def test_a_second_discipline_is_refused_by_the_database(money_project, item):
    IssueRole.objects.create(issue=item, role="antennas")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueRole.objects.create(issue=item, role="firmware")


def test_two_items_may_of_course_hold_the_same_discipline(money_project, item):
    """The constraint moved from `(issue, role)` to `issue`. A test that only
    proved the refusal above would also pass on a constraint that had wandered
    onto `role`, which would stop a project having two firmware tasks."""
    other = Issue.objects.create(
        name="Second",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        created_by=money_project["users"]["owner"],
    )
    IssueRole.objects.create(issue=item, role="firmware")
    IssueRole.objects.create(issue=other, role="firmware")
    assert IssueRole.objects.filter(role="firmware").count() == 2


# --- the 500 that could not be cleared through the UI ------------------------


def test_setting_a_discipline_twice_replaces_it_rather_than_raising(money_project, item):
    """`update_or_create(issue_id=...)` on a non-unique key raised
    MultipleObjectsReturned as soon as an item held two — on the very endpoint
    somebody would have used to fix it."""
    url = role_url(money_project, item)
    client = money_project["clients"]["member"]

    assert client.post(url, {"role": "antennas"}, format="json").status_code == 200
    second = client.post(url, {"role": "firmware"}, format="json")
    assert second.status_code == 200, second.data
    assert second.data["role"] == "firmware"
    assert list(IssueRole.objects.filter(issue=item).values_list("role", flat=True)) == ["firmware"]


def test_clearing_is_still_a_real_answer(money_project, item):
    """"We no longer say" is not "unassigned"."""
    url = role_url(money_project, item)
    client = money_project["clients"]["member"]
    client.post(url, {"role": "firmware"}, format="json")
    cleared = client.post(url, {"role": ""}, format="json")
    assert cleared.status_code == 200
    assert cleared.data["role"] is None
    assert not IssueRole.objects.filter(issue=item).exists()


# --- the writer that produced the plural -------------------------------------


def test_applying_a_plan_records_one_discipline_and_says_it_dropped_the_rest(money_project, item):
    """`ProjectApplyPlanEndpoint` created a row per entry in a plural `roles`
    list. That is where multi-discipline items came from.

    The payload keeps its plural shape — the assistant proposes in the plural and
    the reviewer edits what it proposed — but only the first is stored, and the
    response says how many rows lost a second one. A reviewer who typed one is
    entitled to know it did not land.
    """
    url = reverse(
        "arribada-project-apply-plan",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )
    response = money_project["clients"]["member"].post(
        url,
        {"issues": [{"issue_id": str(item.id), "roles": ["antennas", "firmware"]}]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["roles_set"] == 1
    assert response.data["roles_truncated"] == 1
    assert list(IssueRole.objects.filter(issue=item).values_list("role", flat=True)) == ["antennas"]


def test_applying_a_plan_leaves_an_existing_discipline_alone(money_project, item):
    """A discipline already on the record is either a human's answer or one an
    earlier run wrote. Overwriting it from a re-run would silently re-price the
    item — the hourly rate is looked up by exactly that word."""
    IssueRole.objects.create(issue=item, role="antennas", source=IssueRole.MANUAL)
    url = reverse(
        "arribada-project-apply-plan",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )
    money_project["clients"]["member"].post(
        url, {"issues": [{"issue_id": str(item.id), "roles": ["firmware"]}]}, format="json"
    )
    assert list(IssueRole.objects.filter(issue=item).values_list("role", flat=True)) == ["antennas"]


# --- the discipline still assigns whoever holds it ---------------------------


def test_setting_a_discipline_assigns_its_only_holder(money_project, item):
    """Kept because the one-row rule must not quietly break the reason the model
    exists: a role recorded on an item is how work reaches the person who does
    it, on an instance where most of the team has no Plane account."""
    from plane.db.models import IssueAssignee

    ProjectTeamMember.objects.create(
        project=money_project["project"],
        name="Lead",
        email="lead@arribada.test",
        member=money_project["users"]["lead"],
        roles=["firmware"],
    )
    response = money_project["clients"]["member"].post(
        role_url(money_project, item), {"role": "firmware"}, format="json"
    )
    assert response.status_code == 200
    assert IssueAssignee.objects.filter(
        issue=item, assignee=money_project["users"]["lead"], deleted_at__isnull=True
    ).exists()
