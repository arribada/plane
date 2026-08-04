# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""No endpoint may answer for a work item that is not in the project it was asked about.

Every arribada endpoint is decorated `level="WORKSPACE"`, which checks that the
caller is a member of the WORKSPACE and nothing else. Project isolation therefore
rests entirely on a line each view has to remember to write:

    if not Issue.issue_objects.filter(id=issue_id, project_id=project_id).exists():
        return 404

Four endpoints have shipped without it. The most recent read any work item's
discipline in the database — including one in a Secret project — for anyone
holding a single project id they were entitled to, and it was demonstrated
against production, not theorised. A comment saying "remember the binding" has
now failed four times, so this walks the URLconf instead: any route that takes
both `project_id` and `issue_id` is tested, which means the NEXT one somebody
writes is tested the moment it is routed, without anybody remembering anything.

The assertion is 404 on every method, deliberately strictly. Some of the views
would be safe returning an empty list instead — the join already refuses the
mismatch — but a rule with two acceptable answers cannot be enforced, and the
point of this file is to enforce rather than to describe. Where an endpoint has a
genuine reason to answer differently, name it in `EXPECTED_OTHER` with the reason;
an empty dict is the honest state today.
"""

import pytest
from rest_framework.test import APIClient

from plane.arribada.urls import urlpatterns
from plane.db.models import Issue, Project, ProjectMember, User, Workspace, WorkspaceMember

# Routes whose answer for a mismatched pair is legitimately not a 404, and why.
# Empty on purpose: nothing currently qualifies, and adding an entry should take
# an argument rather than a shrug.
EXPECTED_OTHER: dict[str, int] = {}

# The methods a view may implement. OPTIONS and HEAD are DRF's own and carry no
# project data.
METHODS = ("get", "post", "patch", "put", "delete")


def _issue_scoped_routes():
    """Every route in this app that names both a project and a work item."""
    found = []
    for entry in urlpatterns:
        route = str(entry.pattern)
        if "<uuid:project_id>" not in route or "<uuid:issue_id>" not in route:
            continue
        view = entry.callback
        cls = getattr(view, "cls", None) or getattr(view, "view_class", None)
        if cls is None:
            continue
        methods = [m for m in METHODS if callable(getattr(cls, m, None))]
        found.append((route, cls, methods))
    return found


ROUTES = _issue_scoped_routes()


def test_the_walk_actually_found_the_routes():
    """A guard on the guard.

    If the URLconf is ever restructured — an include(), a router — this file
    would silently test nothing and go on passing, which is worse than not
    existing. Six routes are issue-scoped today; the floor is what matters, not
    the exact number.
    """
    assert len(ROUTES) >= 6, [r[0] for r in ROUTES]
    assert all(methods for _route, _cls, methods in ROUTES)


@pytest.fixture
def two_projects(db):
    """One workspace, two projects, and a work item that lives in the second.

    The caller is an ADMIN member of BOTH, which is the point: this is not about
    somebody sneaking into a project they have no rights to. It is about asking a
    project they DO own for a work item that belongs to another one.
    """
    user = User.objects.create(email="binding@plane.so", first_name="Binding")
    user.set_password("x")
    user.save()
    workspace = Workspace.objects.create(name="Binding WS", owner=user, slug="binding-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)

    mine = Project.objects.create(name="Mine", workspace=workspace, created_by=user, identifier="MINE")
    other = Project.objects.create(name="Other", workspace=workspace, created_by=user, identifier="OTHR")
    for project in (mine, other):
        ProjectMember.objects.create(project=project, workspace=workspace, member=user, role=20)

    issue = Issue.objects.create(project=other, workspace=workspace, name="Not yours", created_by=user)

    client = APIClient()
    client.force_authenticate(user=user)
    return client, workspace.slug, mine, issue


@pytest.mark.parametrize(
    "route,cls,methods",
    ROUTES,
    ids=[r[0] for r in ROUTES],
)
def test_a_mismatched_project_and_work_item_is_refused(route, cls, methods, two_projects):
    client, slug, mine, issue = two_projects
    url = "/api/arribada/" + route.replace("<str:slug>", slug).replace(
        "<uuid:project_id>", str(mine.id)
    ).replace("<uuid:issue_id>", str(issue.id))

    for method in methods:
        # An empty body on purpose. The binding is about WHICH work item is being
        # addressed, so it has to be settled before anything in the payload is
        # looked at — an endpoint that validates its body first would answer 400
        # here and fail, which is the correct outcome: it has told the caller
        # something about a work item it should have refused to discuss.
        response = getattr(client, method)(url, {}, format="json")
        expected = EXPECTED_OTHER.get(route, 404)
        assert response.status_code == expected, (
            f"{method.upper()} {route} answered {response.status_code} for a work item "
            f"in another project; expected {expected}. Add the binding check:\n"
            f"    if not Issue.issue_objects.filter(id=issue_id, project_id=project_id).exists():\n"
            f"        return Response(..., status=404)"
        )
