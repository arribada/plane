# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""One real project, with real rows, for the money tests.

Written because the two suites that already covered this area did not test it.
`test_effort.py` re-implemented the endpoint's arithmetic in a local helper and
asserted against that; `test_cost_by_cycle.py` monkeypatched both managers the
function queries. Both were green, and both stayed green through every defect the
money pass then found — an archived work item silently removing its own cost, a
`FieldError` on a column name, two disciplines producing two different totals. A
test that fakes its subject does not merely fail to catch a bug; it reports that
there is nothing to catch.

So everything here is a database row, and the tests call the endpoints. It is
slower and it is the only version worth having.
"""

import pytest
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.db.models import Project, ProjectMember, State, User, Workspace, WorkspaceMember


@pytest.fixture
def money_project(db):
    """A workspace, a project, and three callers with different authority.

    `lead` is the arribada project lead (a roster row, not a Plane permission —
    see `_is_project_lead`), `member` is an ordinary project member, and `owner`
    is the workspace admin who created everything.

    The project has a real default State because `Issue.issue_objects` filters on
    `state__group` and an item without one cannot be classified.
    """
    owner = User.objects.create(email="owner@arribada.test", username="mw-owner", first_name="Owner")
    workspace = Workspace.objects.create(name="Money", owner=owner, slug="money-fixture")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    project = Project.objects.create(name="Tag", workspace=workspace, created_by=owner, identifier="TAG")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    state = State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    done = State.objects.create(
        name="Done", project=project, workspace=workspace, group="completed", sequence=2
    )

    people = {"owner": owner}
    clients = {}
    for label in ("lead", "member"):
        user = User.objects.create(
            email=f"{label}@arribada.test", username=f"mw-{label}", first_name=label.title()
        )
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=ROLE.MEMBER.value)
        ProjectMember.objects.create(
            project=project, workspace=workspace, member=user, role=ROLE.MEMBER.value
        )
        people[label] = user

    for label, user in people.items():
        client = APIClient()
        client.force_authenticate(user=user)
        clients[label] = client

    return {
        "workspace": workspace,
        "project": project,
        "state": state,
        "done_state": done,
        "users": people,
        "clients": clients,
        "slug": workspace.slug,
        "project_id": str(project.id),
    }
