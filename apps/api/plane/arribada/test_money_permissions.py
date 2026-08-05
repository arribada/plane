# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A guest may not read what the project costs.

For this organisation a guest is a funder or a partner — somebody invited to
follow one project from outside. The Finance tab has excluded them since it
shipped, with a comment saying why, and that was the whole of the protection:
the Overview page rendered the identical budget block with no guard, and the
endpoints under it sat on VIEWER_ROLES, which includes GUEST. Opening
Project -> Overview showed the allocation, the hourly rates, supplier names and
the purchase queue. The API answered them directly too, with no page needed.

Hiding the tab was never the fix. This file tests the layer that is.

BOTH assertions matter and neither is sufficient alone:

- a GUEST is refused. Obvious, and the reason the file exists.
- a MEMBER is served. Less obvious and easier to lose: `MONEY_ROLES = []`, a
  typo in the constant, or somebody "hardening" the decorator would satisfy the
  first assertion perfectly while breaking Finance for the entire team. A test
  that only checks the denial passes on an endpoint that refuses everybody.

The guest fixture is a full, active member of the workspace AND of the project.
The 403 therefore says something about the ROLE and nothing about membership —
which the control at the bottom proves by having the same guest read a
guest-facing endpoint successfully.

Needs a database: the rule under test lives in a decorator that queries
WorkspaceMember, so faking it out would leave nothing to test.

Run explicitly: `python -m pytest plane/arribada/test_money_permissions.py`
"""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.views import MONEY_ROLES, VIEWER_ROLES
from plane.db.models import Issue, Project, ProjectMember, User, Workspace, WorkspaceMember

# Every route that answers with an amount, a rate, a supplier or a purchase
# decision. The second element is the kwargs the route needs; the third is what
# a guest would be reading if this went wrong, so a failure names the leak
# rather than a URL.
MONEY_ROUTES = [
    ("arribada-workspace-role-rates", ("slug",), "what an hour of each discipline costs"),
    ("arribada-project-expenses", ("slug", "project_id"), "the expense sheet, suppliers included"),
    ("arribada-project-budget", ("slug", "project_id"), "the allocation and what is drawn against it"),
    ("arribada-project-procurement", ("slug", "project_id"), "the purchase queue and its decisions"),
    (
        "arribada-issue-fixed-cost",
        ("slug", "project_id", "issue_id"),
        "a work item's price and its supplier",
    ),
]

IDS = [name for name, _kwargs, _what in MONEY_ROUTES]


@pytest.fixture
def money_world(db):
    """One workspace, one project, one work item, and two people on both.

    The only difference between the two callers is their role. Everything else —
    workspace membership, project membership, active flags — is identical, so a
    difference in the answer can only be the role.
    """
    # `username` is unique and has no default — two users created without one
    # collide on the empty string rather than on anything meaningful.
    owner = User.objects.create(email="owner@plane.so", username="money-owner", first_name="Owner")
    owner.set_password("x")
    owner.save()
    workspace = Workspace.objects.create(name="Money WS", owner=owner, slug="money-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    project = Project.objects.create(name="Tags", workspace=workspace, created_by=owner, identifier="TAGS")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    issue = Issue.objects.create(project=project, workspace=workspace, name="Build", created_by=owner)

    clients = {}
    for label, role in (("member", ROLE.MEMBER.value), ("guest", ROLE.GUEST.value)):
        user = User.objects.create(email=f"{label}@plane.so", username=f"money-{label}", first_name=label.title())
        user.set_password("x")
        user.save()
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
        ProjectMember.objects.create(project=project, workspace=workspace, member=user, role=role)
        client = APIClient()
        client.force_authenticate(user=user)
        clients[label] = client

    return {
        "clients": clients,
        "kwargs": {"slug": workspace.slug, "project_id": str(project.id), "issue_id": str(issue.id)},
    }


def _url(name, needs, kwargs):
    return reverse(name, kwargs={key: kwargs[key] for key in needs})


# --- the leak ----------------------------------------------------------------


@pytest.mark.parametrize("name,needs,what", MONEY_ROUTES, ids=IDS)
def test_a_guest_is_refused_the_money(name, needs, what, money_world):
    url = _url(name, needs, money_world["kwargs"])
    response = money_world["clients"]["guest"].get(url)
    assert response.status_code == 403, (
        f"a project GUEST read {what} at {url} (got {response.status_code}). "
        "Money endpoints take MONEY_ROLES, not VIEWER_ROLES."
    )


# --- and the half of it that is easy to lose ---------------------------------


@pytest.mark.parametrize("name,needs,what", MONEY_ROUTES, ids=IDS)
def test_a_member_still_reads_the_money(name, needs, what, money_world):
    url = _url(name, needs, money_world["kwargs"])
    response = money_world["clients"]["member"].get(url)
    assert response.status_code == 200, (
        f"a project MEMBER was refused {what} at {url} (got {response.status_code}). "
        "The guest fix has closed Finance for the people who run the project."
    )


# --- the control -------------------------------------------------------------


def test_the_same_guest_still_reads_a_guest_facing_page(money_world):
    """Proof the 403s above are about money and not about a broken fixture.

    If the guest were simply not a member, or not active, every endpoint in the
    app would refuse them and the five assertions above would pass while testing
    nothing at all.
    """
    kwargs = money_world["kwargs"]
    url = reverse("arribada-project-overview", kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]})
    assert money_world["clients"]["guest"].get(url).status_code == 200


def test_the_two_role_sets_have_not_been_collapsed_into_one():
    """The tempting one-line fix is to drop GUEST from VIEWER_ROLES.

    It would pass every assertion in this file and take the schedule, the
    deliverables, the work items and the team roster out with it — a guest would
    be left with a login and no reason to have one. The two lists exist to say
    different things, so this asserts they still do.
    """
    assert ROLE.GUEST in VIEWER_ROLES
    assert ROLE.GUEST not in MONEY_ROLES
    assert ROLE.ADMIN in MONEY_ROLES and ROLE.MEMBER in MONEY_ROLES
