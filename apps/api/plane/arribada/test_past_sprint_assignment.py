# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A work item can be filed under a sprint that has already ended.

Upstream froze a cycle once its end date passed: the dropdown hid it and
`CycleIssueViewSet.create` answered 400. Work done during a past sprint and
logged afterwards then had nowhere to go. The fork lifted both (ARRIBADA FIX in
`plane/app/views/cycle/issue.py` and in the web cycle dropdown).

The witness is a RUNNING sprint going through the same request: if it fails, the
request itself is broken and the past-sprint assertion proves nothing. The move
test checks the row actually changed, not just the status code, because this
route answers 201 whatever it did.

Needs a database.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    """The handler publishes the activity to Celery on success; CI has no broker."""
    import plane.app.views.cycle.issue as cycle_issue_views

    monkeypatch.setattr(cycle_issue_views.issue_activity, "delay", lambda *a, **k: None)


@pytest.fixture
def world(db):
    owner = User.objects.create(email="ps-owner@arribada.test", username="ps-owner")
    workspace = Workspace.objects.create(name="Past Sprint", owner=owner, slug="past-sprint-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    member = User.objects.create(email="ps-member@arribada.test", username="ps-member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=ROLE.MEMBER.value)
    project = Project.objects.create(name="Tags", workspace=workspace, created_by=owner, identifier="PST")
    for user, role in ((owner, ROLE.ADMIN.value), (member, ROLE.MEMBER.value)):
        ProjectMember.objects.create(project=project, workspace=workspace, member=user, role=role)
    state = State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    issue = Issue.objects.create(
        name="Antenna tuning", project=project, workspace=workspace, state=state, created_by=owner
    )
    now = timezone.now()
    past = Cycle.objects.create(
        name="Sprint 1",
        project=project,
        start_date=now - timedelta(days=28),
        end_date=now - timedelta(days=14),
        owned_by=owner,
    )
    running = Cycle.objects.create(
        name="Sprint 3",
        project=project,
        start_date=now - timedelta(days=3),
        end_date=now + timedelta(days=11),
        owned_by=owner,
    )
    client = APIClient()
    client.force_login(member)
    client.force_authenticate(user=member)
    return {
        "slug": workspace.slug,
        "project": project,
        "issue": issue,
        "past": past,
        "running": running,
        "client": client,
    }


def _add(world, cycle):
    url = (
        f"/api/workspaces/{world['slug']}/projects/{world['project'].id}"
        f"/cycles/{cycle.id}/cycle-issues/"
    )
    return world["client"].post(url, {"issues": [str(world["issue"].id)]}, format="json")


def _cycles_of(world):
    return list(CycleIssue.objects.filter(issue=world["issue"]).values_list("cycle_id", flat=True))


def test_the_witness_a_running_sprint_is_accepted(world):
    answer = _add(world, world["running"])
    assert answer.status_code == 201, answer.content
    assert _cycles_of(world) == [world["running"].id]


def test_a_past_sprint_is_accepted(world):
    answer = _add(world, world["past"])
    assert answer.status_code == 201, answer.content
    assert _cycles_of(world) == [world["past"].id]


def test_a_work_item_moves_from_a_running_sprint_to_a_past_one(world):
    assert _add(world, world["running"]).status_code == 201
    answer = _add(world, world["past"])
    assert answer.status_code == 201, answer.content
    assert _cycles_of(world) == [world["past"].id]
