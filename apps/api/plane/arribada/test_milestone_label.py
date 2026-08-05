# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Marking a milestone, unmarking it, and naming what a funder reads.

One endpoint, three instructions, and two of them used to arrive identically.
`request.data.get("kind")` answers None both when a caller sends `kind: null`
and when a caller never mentions `kind` at all — so a label-only write took the
DELETE branch, removed the mark, and never reached the line that writes a label.
`IssueMilestone.label` was therefore readable by the public funder timeline and
by the PDF, and settable from nowhere.

The distinction under test is presence, not truthiness. It is the kind of thing
that reads as a nitpick in a diff and is the whole difference between "rename
this deliverable" and "this is not a deliverable".

Run explicitly: `python -m pytest plane/arribada/test_milestone_label.py`
"""

import pytest
from rest_framework.test import APIClient

from plane.arribada.models import IssueMilestone
from plane.db.models import Issue, Project, ProjectMember, User, Workspace, WorkspaceMember


@pytest.fixture
def project_and_item(db):
    user = User.objects.create(email="milestone@plane.so", first_name="Milestone")
    user.set_password("x")
    user.save()
    workspace = Workspace.objects.create(name="MS WS", owner=user, slug="ms-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(name="MS", workspace=workspace, created_by=user, identifier="MS")
    ProjectMember.objects.create(project=project, workspace=workspace, member=user, role=20)
    issue = Issue.objects.create(
        project=project, workspace=workspace, name="chase Alex re: the broken rig", created_by=user
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, workspace.slug, project, issue


def url(slug, project):
    return f"/api/arribada/workspaces/{slug}/projects/{project.id}/milestones/"


def test_a_label_only_write_does_not_unmark_the_item(project_and_item):
    """The bug. A body with no `kind` used to delete the row it meant to rename."""
    client, slug, project, issue = project_and_item
    client.post(url(slug, project), {"issue_id": str(issue.id), "kind": "delivery"}, format="json")

    response = client.post(url(slug, project), {"issue_id": str(issue.id), "label": "PDR delivered"}, format="json")

    assert response.status_code == 200
    assert response.json()["kind"] == "delivery"
    row = IssueMilestone.objects.get(issue_id=issue.id)
    assert row.kind == "delivery"
    assert row.label == "PDR delivered"


def test_an_explicit_null_kind_still_unmarks(project_and_item):
    """The other instruction, which must keep working exactly as it did."""
    client, slug, project, issue = project_and_item
    client.post(url(slug, project), {"issue_id": str(issue.id), "kind": "gate"}, format="json")

    response = client.post(url(slug, project), {"issue_id": str(issue.id), "kind": None}, format="json")

    assert response.status_code == 200
    assert response.json()["kind"] is None
    assert not IssueMilestone.objects.filter(issue_id=issue.id).exists()


def test_a_label_on_an_unmarked_item_is_refused(project_and_item):
    """Creating the mark here would let a stray label turn an ordinary work item
    into something a funder is told to expect."""
    client, slug, project, issue = project_and_item

    response = client.post(url(slug, project), {"issue_id": str(issue.id), "label": "PDR delivered"}, format="json")

    assert response.status_code == 400
    assert not IssueMilestone.objects.filter(issue_id=issue.id).exists()


def test_an_empty_label_clears_it_rather_than_being_ignored(project_and_item):
    """Emptying the box means "go back to the work item's own name"."""
    client, slug, project, issue = project_and_item
    client.post(
        url(slug, project), {"issue_id": str(issue.id), "kind": "delivery", "label": "PDR delivered"}, format="json"
    )

    response = client.post(url(slug, project), {"issue_id": str(issue.id), "label": ""}, format="json")

    assert response.status_code == 200
    assert IssueMilestone.objects.get(issue_id=issue.id).label == ""


def test_changing_the_kind_alone_leaves_the_label_alone(project_and_item):
    """The regression this endpoint already carries a comment about."""
    client, slug, project, issue = project_and_item
    client.post(
        url(slug, project), {"issue_id": str(issue.id), "kind": "delivery", "label": "PDR delivered"}, format="json"
    )

    client.post(url(slug, project), {"issue_id": str(issue.id), "kind": "review"}, format="json")

    row = IssueMilestone.objects.get(issue_id=issue.id)
    assert (row.kind, row.label) == ("review", "PDR delivered")


def test_the_read_separates_the_written_label_from_the_fallback(project_and_item):
    """A form that prefilled from `label` would save the work item's own name as
    a custom label the first time anybody opened the box."""
    client, slug, project, issue = project_and_item
    client.post(url(slug, project), {"issue_id": str(issue.id), "kind": "delivery"}, format="json")

    row = client.get(url(slug, project)).json()["milestones"][0]

    assert row["label"] == "chase Alex re: the broken rig"
    assert row["custom_label"] == ""


def test_a_nonsense_kind_is_still_refused(project_and_item):
    client, slug, project, issue = project_and_item

    response = client.post(url(slug, project), {"issue_id": str(issue.id), "kind": "milestone"}, format="json")

    assert response.status_code == 400
    assert not IssueMilestone.objects.filter(issue_id=issue.id).exists()
