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

WHICH role, though, is the second half of this file. The first fix put
MONEY_ROLES on the decorator and left it at level="WORKSPACE", where the role it
tests is the caller's role in the WORKSPACE. A person can hold a different role
in each place, and the one combination that matters here — workspace MEMBER,
project GUEST — walked straight through: hidden by the client, served by the
API, which is not a permission. level="PROJECT" asks the project instead and
keeps upstream's explicit workspace-admin fall-through, so the four project
endpoints now answer the project's own answer.

The three callers below exist to pin the three edges of that rule, because two
of them look like breakage if you only read the diff:

- workspace MEMBER + project GUEST -> refused. The hole. Nothing else in this
  file catches it: the original guest is a guest in both places.
- workspace ADMIN + project GUEST -> served. The fall-through. Without it,
  level="PROJECT" would lock an admin out of a project they run.
- workspace ADMIN, not on the project -> refused, and refused identically on a
  non-money endpoint. That is `_visible_projects`, which every endpoint in this
  app already applies and which answered that caller 404 long before money had a
  role list. Money is not doing anything special to them, and the control proves
  it rather than asserting it.

Needs a database: the rule under test lives in a decorator that queries
WorkspaceMember and ProjectMember, so faking it out would leave nothing to test.

Run explicitly: `python -m pytest plane/arribada/test_money_permissions.py`
"""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.models import ProjectSchedule, ProjectTeamMember
from plane.arribada.serializers import MONEY_FIELDS, ProjectScheduleSerializer
from plane.arribada.views import MONEY_ROLES, VIEWER_ROLES
from plane.db.models import Issue, Project, ProjectMember, User, Workspace, WorkspaceMember

# Every route that answers with an amount, a rate, a supplier or a purchase
# decision. The second element is the kwargs the route needs; the third is what
# a guest would be reading if this went wrong, so a failure names the leak
# rather than a URL.
# Project-scoped: there is a project in the URL, so the project's own role list
# is the one that decides. These are the four that move to level="PROJECT".
PROJECT_MONEY_ROUTES = [
    ("arribada-project-expenses", ("slug", "project_id"), "the expense sheet, suppliers included"),
    ("arribada-project-budget", ("slug", "project_id"), "the allocation and what is drawn against it"),
    ("arribada-project-procurement", ("slug", "project_id"), "the purchase queue and its decisions"),
    (
        "arribada-issue-fixed-cost",
        ("slug", "project_id", "issue_id"),
        "a work item's price and its supplier",
    ),
]

# Workspace-scoped: no project in the URL and no project it could belong to. The
# rate card is the same card whichever project you name, and my-approvals spans
# all of them. The workspace role is the right question for these two, so they
# stay at level="WORKSPACE" — deliberately, not by omission.
WORKSPACE_MONEY_ROUTES = [
    ("arribada-workspace-role-rates", ("slug",), "what an hour of each discipline costs"),
    ("arribada-workspace-my-approvals", ("slug",), "purchase totals and suppliers across every project"),
]

MONEY_ROUTES = WORKSPACE_MONEY_ROUTES + PROJECT_MONEY_ROUTES

IDS = [name for name, _kwargs, _what in MONEY_ROUTES]
PROJECT_IDS = [name for name, _kwargs, _what in PROJECT_MONEY_ROUTES]


@pytest.fixture
def money_world(db):
    """One workspace, one project, one work item, and five people around them.

    The only difference between the callers is which role they hold WHERE.
    Everything else — active flags, the workspace, the project, the work item —
    is identical, so a difference in the answer can only be a role.

        label                     workspace   project
        member                    MEMBER      MEMBER
        guest                     GUEST       GUEST
        ws_member_project_guest   MEMBER      GUEST      <- the hole
        ws_admin_project_guest    ADMIN       GUEST      <- the fall-through
        ws_admin_outsider         ADMIN       (none)     <- project scoping

    `ws_admin_outsider` deliberately has no ProjectMember row at all. Passing
    None below is the point of the test, not an oversight.
    """
    # `username` is unique and has no default — two users created without one
    # collide on the empty string rather than on anything meaningful.
    #
    # No passwords: `force_authenticate` bypasses password checking entirely, and
    # Django's PBKDF2 default is several hundred thousand iterations — six users a
    # fixture across thirty tests was minutes of hashing per run to prove nothing.
    owner = User.objects.create(email="owner@plane.so", username="money-owner", first_name="Owner")
    workspace = Workspace.objects.create(name="Money WS", owner=owner, slug="money-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    project = Project.objects.create(name="Tags", workspace=workspace, created_by=owner, identifier="TAGS")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    issue = Issue.objects.create(project=project, workspace=workspace, name="Build", created_by=owner)

    clients = {}
    cast = (
        ("member", ROLE.MEMBER.value, ROLE.MEMBER.value),
        ("guest", ROLE.GUEST.value, ROLE.GUEST.value),
        ("ws_member_project_guest", ROLE.MEMBER.value, ROLE.GUEST.value),
        ("ws_admin_project_guest", ROLE.ADMIN.value, ROLE.GUEST.value),
        ("ws_admin_outsider", ROLE.ADMIN.value, None),
    )
    for label, workspace_role, project_role in cast:
        user = User.objects.create(email=f"{label}@plane.so", username=f"money-{label}", first_name=label.title())
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=workspace_role)
        if project_role is not None:
            ProjectMember.objects.create(project=project, workspace=workspace, member=user, role=project_role)
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


# --- which role, and where it is held ----------------------------------------


@pytest.mark.parametrize("name,needs,what", PROJECT_MONEY_ROUTES, ids=PROJECT_IDS)
def test_a_project_guest_is_refused_even_when_the_workspace_calls_them_a_member(name, needs, what, money_world):
    """The hole MONEY_ROLES on its own left open.

    At level="WORKSPACE" the decorator reads the caller's WORKSPACE role, so this
    person answered ROLE.MEMBER and was served — while the client, reading their
    PROJECT role, had hidden every one of these surfaces from them. A rule the
    client enforces and the server does not is not a rule.

    This is not a contrived account. It is anyone with an ordinary seat here who
    was put on one project as a guest — the usual reason being that this is the
    project they are not supposed to see the money for.
    """
    url = _url(name, needs, money_world["kwargs"])
    response = money_world["clients"]["ws_member_project_guest"].get(url)
    assert response.status_code == 403, (
        f"a project GUEST read {what} at {url} on the strength of being a workspace MEMBER "
        f"(got {response.status_code}). Project money takes level=\"PROJECT\"; at level=\"WORKSPACE\" "
        "the role that gets tested is the wrong one."
    )


@pytest.mark.parametrize("name,needs,what", PROJECT_MONEY_ROUTES, ids=PROJECT_IDS)
def test_a_workspace_admin_reads_a_project_they_are_only_a_guest_on(name, needs, what, money_world):
    """The half of level="PROJECT" that is easy to throw away by accident.

    Upstream's `allow_permission` does not stop at the project role: it falls
    through to a second branch that admits a workspace ADMIN whatever their role
    on the project, provided they are on it. That fall-through is the reason
    level="PROJECT" is safe to use here, and a hand-rolled guard that only read
    ProjectMember.role would pass every other test in this file while locking the
    person who runs the organisation out of its budget.
    """
    url = _url(name, needs, money_world["kwargs"])
    response = money_world["clients"]["ws_admin_project_guest"].get(url)
    assert response.status_code == 200, (
        f"a workspace ADMIN was refused {what} at {url} because their PROJECT role is guest "
        f"(got {response.status_code}). level=\"PROJECT\" must keep upstream's workspace-admin "
        "fall-through — see plane/app/permissions/base.py."
    )


@pytest.mark.parametrize("name,needs,what", PROJECT_MONEY_ROUTES, ids=PROJECT_IDS)
def test_an_admin_who_is_not_on_the_project_is_out_of_scope_rather_than_out_of_money(
    name, needs, what, money_world
):
    """Denied — and denied for a reason that has nothing to do with money.

    Every endpoint in this app scopes itself with `_visible_projects`, which asks
    for an active ProjectMember row and 404s without one. This caller therefore
    could not read this project's schedule, deliverables or work items either,
    and could not read its budget before MONEY_ROLES existed. Moving to
    level="PROJECT" changes the number on the denial, not the answer.

    Asserted as "refused", not as a specific code, because 403 and 404 here are
    the same event seen from two lines of the same function: whichever of the
    decorator and `_visible_projects` speaks first. The companion test below is
    what makes this meaningful — without it, this would pass on an endpoint that
    had simply broken.
    """
    url = _url(name, needs, money_world["kwargs"])
    response = money_world["clients"]["ws_admin_outsider"].get(url)
    assert response.status_code in (403, 404), (
        f"someone who is not on the project read {what} at {url} (got {response.status_code}). "
        "Nothing in this app answers for a project the caller has no ProjectMember row on."
    )


def test_that_admin_is_shut_out_of_the_whole_project_not_just_its_money(money_world):
    """The companion. Same caller, a non-money, guest-facing endpoint.

    If this returned 200 while the four above returned 403, money would be doing
    something to workspace admins that the rest of the fork does not, and the
    rule would need arguing about rather than documenting. It does not: project
    membership gates everything here, and this is the assertion that says so out
    loud instead of leaving it to be rediscovered.
    """
    kwargs = money_world["kwargs"]
    url = reverse("arribada-project-overview", kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]})
    response = money_world["clients"]["ws_admin_outsider"].get(url)
    assert response.status_code in (403, 404), (
        f"a workspace admin who is not on the project read its Overview (got {response.status_code}). "
        "If that is now allowed, the money rule needs revisiting with it — not separately."
    )


def test_the_rate_card_is_a_workspace_fact_and_stays_one(money_world):
    """Why the two workspace-scoped money endpoints did NOT move to level="PROJECT".

    There is no project in either URL. `level="PROJECT"` reads
    `kwargs["project_id"]` and there is none to read, so the question the fix
    asks of the other four cannot even be put here — and it would be the wrong
    question anyway. A rate card is one card for the organisation, not a fact
    about a project, and the person below works here: workspace MEMBER, whatever
    they are on any single project. The role that decides is the workspace one.

    The guest — the funder, the partner, the population this whole file exists
    for — is still refused it, by the parametrized test at the top.
    """
    kwargs = money_world["kwargs"]
    for name, needs, what in WORKSPACE_MONEY_ROUTES:
        url = _url(name, needs, kwargs)
        response = money_world["clients"]["ws_member_project_guest"].get(url)
        assert response.status_code == 200, (
            f"a workspace MEMBER was refused {what} at {url} (got {response.status_code}) "
            "because of their role on one project. This endpoint has no project."
        )


# --- and the same rule on the way in -----------------------------------------


def test_a_project_guest_cannot_raise_a_purchase_request_against_the_project(money_world):
    """Reading the money was the reported bug; writing it was the same mistake.

    The write methods sat on `[ROLE.ADMIN, ROLE.MEMBER]` — the same list as
    MONEY_ROLES — at the same level="WORKSPACE", so the same person who could read
    the purchase queue could also add to it, on a project they are a guest of.
    A row in the procurement table is what makes this worse than a leak: it is
    addressed to the project lead and asks them to spend money.
    """
    kwargs = money_world["kwargs"]
    url = _url("arribada-project-procurement", ("slug", "project_id"), kwargs)
    body = {"label": "A thing I should not be able to ask for", "amount": 4200}

    refused = money_world["clients"]["ws_member_project_guest"].post(url, body, format="json")
    assert refused.status_code == 403, (
        f"a project GUEST filed a purchase request (got {refused.status_code}). "
        "The write methods take the same level as the read."
    )

    # The other half, for the same reason it is asserted on every read above: a
    # decorator that refuses everybody would satisfy the assertion above and take
    # procurement away from the people the queue is for.
    allowed = money_world["clients"]["member"].post(url, body, format="json")
    assert allowed.status_code == 201, (
        f"a project MEMBER could not raise a purchase request (got {allowed.status_code}). "
        "Anyone on the project raises one; the lead approves it."
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


# --- the fifth door: the budget that is not on a route called "budget" -------
#
# Everything above enumerates routes by hand, and that is exactly how this one
# stayed open. `budget_amount` and `budget_currency` live on the project SCHEDULE
# row — there is nowhere else for a project's single settings row to put them —
# so they were served by GET /schedule/ at VIEWER_ROLES and rewritten by PATCH
# /schedule/ on the dates' permissions. The list above was written from the URLs
# with "budget" in them, and this URL says "schedule".
#
# `test_project_role_boundary.py` walks the URLconf so the LEVEL can never be
# wrong again. It cannot know that two columns of one serializer answer to a
# different audience from the other seven, which is what these tests are for.


def test_the_allocation_does_not_leave_through_the_schedule(money_world):
    """A guest reads the plan. The allocation is not the plan."""
    kwargs = money_world["kwargs"]
    url = reverse(
        "arribada-project-schedule",
        kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]},
    )

    served = money_world["clients"]["member"].get(url)
    assert served.status_code == 200
    assert "budget_amount" in served.data, (
        "the allocation has disappeared for the people who run the project — the strip is "
        "conditional on the caller's role, not unconditional."
    )

    leaked = money_world["clients"]["guest"].get(url)
    assert leaked.status_code == 200, (
        "the schedule itself must still answer a guest: the dates, the lock flags and the "
        "delivery-floor switch are the plan they were invited to follow."
    )
    for field in MONEY_FIELDS:
        assert field not in leaked.data, (
            f"a project GUEST read {field} from the schedule (value {leaked.data.get(field)!r}). "
            "It is the same figure ProjectBudgetEndpoint serves behind MONEY_ROLES."
        )


def test_the_same_leak_at_the_role_the_first_fix_tested_wrongly(money_world):
    """Workspace MEMBER, project GUEST — the account the whole exercise is about."""
    kwargs = money_world["kwargs"]
    url = reverse(
        "arribada-project-schedule",
        kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]},
    )
    response = money_world["clients"]["ws_member_project_guest"].get(url)
    assert response.status_code == 200
    assert "budget_amount" not in response.data


def test_only_the_lead_rewrites_what_the_project_was_given_to_spend(money_world):
    """Writing the allocation is the lead's, because spending against it is.

    `_lead_guard` protects the expense sheet and the purchase decision that
    creates an expense. The ceiling those are read against sat behind no guard at
    all: PATCH /schedule/ took `budget_amount` off the body through a serializer
    that had it writable, so any member could raise the limit and make the guard
    on the sheet decorative. The client has always gated the field on exactly
    this — `canEdit = canApprove` in budget-block.tsx.
    """
    kwargs = money_world["kwargs"]
    project = Project.objects.get(id=kwargs["project_id"])
    # An explicit lead, so `_lead_guard` is answering about a job rather than
    # falling through to "this project has nobody, let an admin decide".
    project.project_lead = User.objects.get(email="owner@plane.so")
    project.save(update_fields=["project_lead"])

    url = reverse(
        "arribada-project-schedule",
        kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]},
    )

    refused = money_world["clients"]["member"].patch(url, {"budget_amount": 999999}, format="json")
    assert refused.status_code == 403, (
        f"a project MEMBER rewrote the allocation (got {refused.status_code}). "
        "It is the ceiling the expense sheet is read against, and the sheet is lead-only."
    )
    assert ProjectSchedule.objects.get(project_id=project.id).budget_amount is None

    # The dates on the same row are NOT the lead's, and must not become so —
    # locking the whole endpoint would be a plausible fix and a bad one.
    dates = money_world["clients"]["member"].patch(url, {"start_date": "2026-01-01"}, format="json")
    assert dates.status_code == 200, (
        f"a project MEMBER can no longer set the project's dates (got {dates.status_code}). "
        "Only the two money columns moved behind the lead guard."
    )


def test_the_allocation_cannot_be_written_through_the_serializer_at_all(money_world):
    """Belt and braces, and the reason the lock is on the serializer.

    A handler check protects one handler. `read_only_fields` protects the next
    view somebody writes that pipes a request body through this serializer —
    which is how the field came to be writable in the first place, since nobody
    ever decided that it should be.
    """
    schedule, _ = ProjectSchedule.objects.get_or_create(
        project_id=money_world["kwargs"]["project_id"]
    )
    serializer = ProjectScheduleSerializer(
        schedule, data={"budget_amount": 500, "budget_currency": "USD"}, partial=True
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    schedule.refresh_from_db()
    assert schedule.budget_amount is None, "ProjectScheduleSerializer still writes the allocation"


# --- and the way in to the figure, one step further back --------------------


@pytest.mark.parametrize(
    "name,body,what",
    [
        ("arribada-issue-effort", {"days": 999}, "the person-days labour cost is multiplied by"),
        ("arribada-issue-role", {"role": "embedded firmware"}, "the discipline the rate keys on"),
    ],
)
def test_a_project_guest_cannot_move_the_multiplicands_of_labour_cost(name, body, what, money_world):
    """403 on GET /budget/ is not much use if the inputs are open.

    `_labour_cost` multiplies an item's days by its discipline's hourly rate. Both
    were written on `[ROLE.ADMIN, ROLE.MEMBER]` at level="WORKSPACE", so the guest
    correctly refused the budget could still POST `{"days": 999}` and inflate the
    figure in the funder's printed annex. They now take MONEY_ROLES.
    """
    kwargs = money_world["kwargs"]
    url = reverse(name, kwargs={key: kwargs[key] for key in ("slug", "project_id", "issue_id")})
    response = money_world["clients"]["ws_member_project_guest"].post(url, body, format="json")
    assert response.status_code == 403, f"a project GUEST set {what} (got {response.status_code})."


@pytest.mark.parametrize(
    "name,body",
    [("arribada-issue-effort", {"days": 3}), ("arribada-issue-role", {"role": "firmware"})],
)
def test_a_project_member_still_estimates_their_own_work(name, body, money_world):
    """Estimating is what the team does all day; only the guest was the problem."""
    kwargs = money_world["kwargs"]
    url = reverse(name, kwargs={key: kwargs[key] for key in ("slug", "project_id", "issue_id")})
    assert money_world["clients"]["member"].post(url, body, format="json").status_code == 200


def test_reading_an_estimate_is_still_a_guest_facing_answer(money_world):
    """Deliberately NOT moved, and worth saying so.

    A number of days is not an amount, and without the rate card — MONEY_ROLES,
    workspace-scoped — it cannot be turned into one. A guest reading the plan is
    entitled to know how big the work is. They are not entitled to change it.
    """
    kwargs = money_world["kwargs"]
    url = reverse(
        "arribada-issue-effort",
        kwargs={key: kwargs[key] for key in ("slug", "project_id", "issue_id")},
    )
    assert money_world["clients"]["guest"].get(url).status_code == 200


# --- and the shortest path to spending the money: become the lead -----------


def test_the_roster_cannot_be_used_to_appoint_its_own_lead(money_world):
    """`is_lead` came straight off the request body, and `_is_project_lead` reads it.

    That made one PUT the whole distance between an ordinary member and approving
    spend — every `_lead_guard` in this file asks a question this handler let the
    caller answer about themselves. It is worse than escalation because the
    handler is a full replace: the same request demotes the incumbent and deletes
    everyone left off the list.
    """
    kwargs = money_world["kwargs"]
    project = Project.objects.get(id=kwargs["project_id"])
    owner = User.objects.get(email="owner@plane.so")
    project.project_lead = owner
    project.save(update_fields=["project_lead"])
    ProjectTeamMember.objects.create(
        project=project, name="Owner", email="owner@plane.so", is_lead=True
    )

    url = reverse(
        "arribada-project-team", kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]}
    )
    coup = {"team": [{"name": "Member", "email": "member@plane.so", "is_lead": True}]}

    refused = money_world["clients"]["member"].put(url, coup, format="json")
    assert refused.status_code == 403, (
        f"a project MEMBER made themselves the lead (got {refused.status_code}), which is the "
        "role _lead_guard checks before approving a purchase into ProjectExpense."
    )
    assert not ProjectTeamMember.objects.filter(project=project, email="member@plane.so").exists()
    # The guard returns before the transaction, so the roster it would have
    # replaced is still there. A refusal that had already deleted the incumbent
    # would be the same attack with an error message.
    assert ProjectTeamMember.objects.filter(project=project, is_lead=True).count() == 1


def test_an_ordinary_roster_edit_is_still_an_ordinary_thing_to_do(money_world, settings):
    """Adding a person, fixing an address, recording a discipline — no permission.

    Guarding the whole handler would have been the easy fix and the wrong one:
    the roster is how work gets routed to disciplines, and a roster only the lead
    can touch is a roster that goes stale.
    """
    # `settings`: a successful roster edit ends in `_materialise_issue_roles`,
    # which builds notification links through `base_host` — and that raises
    # ImproperlyConfigured rather than returning None when neither APP_BASE_URL
    # nor WEB_URL is set, which is the case under the test settings. Nothing to
    # do with permissions; it is simply that no test had ever driven this handler
    # all the way through before, so the 500 had nowhere to show up.
    settings.WEB_URL = "https://plane.test"

    kwargs = money_world["kwargs"]
    project = Project.objects.get(id=kwargs["project_id"])
    project.project_lead = User.objects.get(email="owner@plane.so")
    project.save(update_fields=["project_lead"])

    url = reverse(
        "arribada-project-team", kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]}
    )
    response = money_world["clients"]["member"].put(
        url,
        {"team": [{"name": "Ruby", "email": "ruby@plane.so", "roles": ["embedded firmware"]}]},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert ProjectTeamMember.objects.filter(project=project, email="ruby@plane.so").exists()


def test_the_lead_appoints_the_lead(money_world, settings):
    """The half that is easy to lose: somebody has to be able to hand it over.

    The lead here is a workspace ADMIN who is only a GUEST on this project, which
    makes the test do double duty: the roster PUT is decorated `[ADMIN, MEMBER]`
    at level="PROJECT", so reaching the lead guard at all depends on upstream's
    workspace-admin fall-through. If that were ever dropped, the person who runs
    the organisation could not hand over a project they own.
    """
    # `settings`: a successful roster edit ends in `_materialise_issue_roles`,
    # which builds notification links through `base_host` — and that raises
    # ImproperlyConfigured rather than returning None when neither APP_BASE_URL
    # nor WEB_URL is set, which is the case under the test settings. Nothing to
    # do with permissions; it is simply that no test had ever driven this handler
    # all the way through before, so the 500 had nowhere to show up.
    settings.WEB_URL = "https://plane.test"

    kwargs = money_world["kwargs"]
    project = Project.objects.get(id=kwargs["project_id"])
    project.project_lead = User.objects.get(email="ws_admin_project_guest@plane.so")
    project.save(update_fields=["project_lead"])

    url = reverse(
        "arribada-project-team", kwargs={"slug": kwargs["slug"], "project_id": kwargs["project_id"]}
    )
    response = money_world["clients"]["ws_admin_project_guest"].put(
        url,
        {"team": [{"name": "Member", "email": "member@plane.so", "is_lead": True}]},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert ProjectTeamMember.objects.get(project=project, email="member@plane.so").is_lead
