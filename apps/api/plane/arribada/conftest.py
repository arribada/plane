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


@pytest.fixture(autouse=True)
def _no_leaked_timezone():
    """Put the process back in the default zone around every test.

    WHY THIS EXISTS, because it looks like housekeeping and is not.
    `TimezoneMixin.initial` — which every view in this app inherits through
    `BaseAPIView` — calls `django.utils.timezone.activate()` with the caller's
    own zone, and calls `deactivate()` only for an ANONYMOUS caller. `activate`
    writes a thread-local that outlives the request, so the last authenticated
    caller's zone stays current for everything that runs afterwards in the same
    worker.

    `test_caller_day.py` sets a user to `Pacific/Auckland` and makes requests
    through that mixin. Every test that ran after it in the same process then
    computed `timezone.localdate()` in Auckland — which, from 12:00 UTC onwards,
    is already TOMORROW.

    That is the whole of the defect this repo has been calling "the backend job
    goes red every UTC afternoon", and both halves of its behaviour fall out of
    it: the file passes when run ALONE because nothing activated Auckland, and
    it fails in the FULL SUITE only after noon UTC because that is when the two
    zones stop agreeing about the date.

    The concrete failure is `test_capacity_part_time.py::test_a_fully_booked_
    full_timer_reads_one_hundred_percent`: its fixture builds work-item dates
    from a leaked-Auckland `today`, the endpoint recomputes `today` in UTC after
    the mixin re-activates the requesting user's own zone, the two windows are
    offset by one day, and one working day of forty falls outside — `98 == 100`.

    Deactivating BEFORE as well as after, so a test is protected from whatever
    ran before it even if that test bypassed this fixture.
    """
    from django.utils import timezone as _dj_timezone

    _dj_timezone.deactivate()
    yield
    _dj_timezone.deactivate()
