# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A deleted work item takes its milestone and its checklist lines with it.

`IssueMilestone` and `IssueChecklistItem` have no `deleted_at` of their own —
their existence is the fact — and their reads joined through the plain FK, which
applies no manager (ARRIBADA.md, "Project.objects is a SoftDeletionManager";
the same trap one table over). Plane never hard-deletes, so the CASCADE on the
FK never fires, and:

* a deleted work item's deliverable stayed on the chart, in the funder list and
  in the Home widget's "due next" for good;
* a deleted checklist member kept counting against its owner's total, never
  done, so a checklist whose last open line had been deleted read 2/3 forever.

Every read here now asks the join for `deleted_at IS NULL`, and the workspace
deliverables leave archived projects out the way the portfolio does.

Run explicitly: `python -m pytest plane/arribada/test_soft_deleted_planning_rows.py`
"""

from datetime import date, datetime, timezone as dt_timezone

import pytest
from django.urls import reverse

from plane.arribada.models import IssueChecklistItem, IssueMilestone
from plane.db.models import Issue, Project, ProjectMember

GONE = datetime(2026, 9, 1, 12, 0, tzinfo=dt_timezone.utc)


def item(world, name, project=None, **fields):
    return Issue.objects.create(
        name=name,
        project=project or world["project"],
        workspace=world["workspace"],
        state=world["state"],
        created_by=world["users"]["owner"],
        **fields,
    )


def soft_delete(issue):
    """The way the product deletes: the row stays, `deleted_at` is set."""
    Issue.objects.filter(id=issue.id).update(deleted_at=GONE)


@pytest.fixture
def marked(money_project):
    """Two deliverables, one of them on a work item that has since been deleted."""
    kept = item(money_project, "PDR delivered", target_date=date(2027, 3, 5))
    gone = item(money_project, "Old PDR", target_date=date(2027, 2, 1))
    IssueMilestone.objects.create(issue=kept, kind=IssueMilestone.DELIVERY)
    IssueMilestone.objects.create(issue=gone, kind=IssueMilestone.GATE)
    soft_delete(gone)
    return {**money_project, "kept": kept, "gone": gone}


# --- milestones ---------------------------------------------------------------


def test_a_deleted_items_milestone_is_not_listed_for_the_project(marked):
    url = reverse(
        "arribada-project-milestones",
        kwargs={"slug": marked["slug"], "project_id": marked["project_id"]},
    )
    response = marked["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert [m["issue_id"] for m in response.data["milestones"]] == [str(marked["kept"].id)], (
        "a deleted work item's milestone is still a deliverable on the chart"
    )


def test_a_deleted_items_milestone_is_not_due_next_on_the_home_widget(marked):
    url = reverse("arribada-workspace-deliverables", kwargs={"slug": marked["slug"]})
    response = marked["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    listed = [d["issue_id"] for d in response.data["deliverables"]]
    assert str(marked["gone"].id) not in listed
    assert listed == [str(marked["kept"].id)]


def test_an_archived_projects_deliverables_are_not_due_next_either(marked):
    """The portfolio leaves archived projects out by default; nothing is due on
    a shelved project, and the widget exists to say what is due."""
    shelved = Project.objects.create(
        name="Shelved",
        workspace=marked["workspace"],
        created_by=marked["users"]["owner"],
        identifier="SHV",
    )
    ProjectMember.objects.create(
        project=shelved, workspace=marked["workspace"], member=marked["users"]["member"], role=15
    )
    old = item(marked, "Shelved deliverable", project=shelved, target_date=date(2027, 1, 10))
    IssueMilestone.objects.create(issue=old, kind=IssueMilestone.DELIVERY)
    Project.objects.filter(id=shelved.id).update(archived_at=GONE)

    url = reverse("arribada-workspace-deliverables", kwargs={"slug": marked["slug"]})
    listed = [d["issue_id"] for d in marked["clients"]["member"].get(url).data["deliverables"]]
    assert str(old.id) not in listed
    assert str(marked["kept"].id) in listed


# --- checklists ---------------------------------------------------------------


@pytest.fixture
def listed(money_project):
    """An owner with two lines, one of which has been deleted."""
    owner = item(money_project, "Field deployment")
    kept = item(money_project, "Pack the tags")
    gone = item(money_project, "Book the boat")
    IssueChecklistItem.objects.create(owner=owner, member=kept, sort_order=1)
    IssueChecklistItem.objects.create(owner=owner, member=gone, sort_order=2)
    soft_delete(gone)
    return {**money_project, "owner": owner, "kept": kept, "gone": gone}


def test_a_deleted_member_is_no_longer_a_line_on_the_checklist(listed):
    url = reverse(
        "arribada-issue-checklist",
        kwargs={
            "slug": listed["slug"],
            "project_id": listed["project_id"],
            "issue_id": str(listed["owner"].id),
        },
    )
    response = listed["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert [line["issue_id"] for line in response.data["items"]] == [str(listed["kept"].id)], (
        "a deleted work item is still a line on the checklist"
    )


def test_a_deleted_member_no_longer_counts_in_the_summary(listed):
    url = reverse(
        "arribada-project-checklist-summary",
        kwargs={"slug": listed["slug"], "project_id": listed["project_id"]},
    )
    response = listed["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert response.data["summaries"][str(listed["owner"].id)] == {"done": 0, "total": 1}, (
        "a deleted line still counts against its owner's total"
    )


def test_a_deleted_owner_has_no_summary(listed):
    soft_delete(listed["owner"])
    url = reverse(
        "arribada-project-checklist-summary",
        kwargs={"slug": listed["slug"], "project_id": listed["project_id"]},
    )
    assert listed["clients"]["member"].get(url).data["summaries"] == {}
