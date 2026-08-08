# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The shape of what these endpoints ask the database, not just what they answer.

Three defects live here, and none of them can be caught by asserting on a
response body — every one of them returned the right JSON.

* `ProjectDisciplineGapEndpoint.get` called `_role_from_assignees` once per row,
  inside the response comprehension, over an unsliced queryset: 84 queries for 77
  rows, 77 of them byte-identical. The endpoint exists to list every dated item
  with NO discipline, so its cost grew with exactly the problem it reports.

* `__iexact` compiles to `UPPER(col) = UPPER(%s)`. Every case-insensitive index in
  this app is on `lower(col)`, so all four call sites sequential-scanned — one of
  them inside an uncapped loop over the request body.

* `Meta.ordering` joins the SELECT of a `DISTINCT`, so
  `.values_list("repo").distinct()` de-duplicated on (repo, github_created_at) and
  therefore on nothing.

So the assertions are about counts and SQL text. The rule for the count ones is
"the query count must not grow with the row count" rather than a fixed number: a
fixed number is a test that fails on the next unrelated `select_related`, and
gets raised rather than read.

Run explicitly: `python -m pytest plane/arribada/test_query_shapes.py`
"""

from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from plane.arribada.models import (
    BaselineEntry,
    GithubIssue,
    IssueChecklistItem,
    ProjectBaseline,
    ProjectDiscipline,
    ProjectIssueOrder,
    ProjectTeamMember,
)
from plane.arribada.github_sync_task import repos_with_open_issues
from plane.arribada.views import _ci
from plane.db.models import Issue, IssueAssignee

MONDAY = date(2026, 8, 3)
FRIDAY = date(2026, 8, 7)


def _dated_items(world, count):
    """`count` dated work items with an assignee and NO discipline.

    An assignee on every one is what makes the old version's per-row lookup fire;
    without it the inference short-circuits and the endpoint looks innocent.
    """
    made = []
    for n in range(count):
        issue = Issue.objects.create(
            name=f"Item {n}",
            project=world["project"],
            workspace=world["workspace"],
            state=world["state"],
            start_date=MONDAY,
            target_date=FRIDAY,
            created_by=world["users"]["owner"],
        )
        IssueAssignee.objects.create(
            issue=issue,
            assignee=world["users"]["member"],
            project=world["project"],
            workspace=world["workspace"],
        )
        made.append(issue)
    return made


def _count_queries(client, url):
    with CaptureQueriesContext(connection) as captured:
        response = client.get(url)
    assert response.status_code == 200, response.data
    return len(captured), response.data


@pytest.mark.django_db
def test_discipline_gap_query_count_does_not_grow_with_the_rows(money_project):
    """The fork's worst endpoint: one query per row, in a response comprehension."""
    world = money_project
    url = reverse(
        "arribada-project-discipline-gap",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    client = world["clients"]["member"]

    _dated_items(world, 3)
    small, small_body = _count_queries(client, url)

    _dated_items(world, 12)
    large, large_body = _count_queries(client, url)

    assert len(small_body["items"]) == 3
    assert len(large_body["items"]) == 15
    assert large == small, (
        f"{small} queries for 3 rows, {large} for 15 — the per-row lookup is back"
    )
    # A ceiling as well as a slope: constant-but-enormous is not a pass either.
    assert large <= 15, f"{large} queries to list 15 rows"


@pytest.mark.django_db
def test_discipline_gap_still_infers_the_discipline_it_used_to(money_project):
    """The batch must answer exactly what the per-row version answered.

    One assignee holding exactly one discipline is an inference. Two disciplines,
    or two assignees, is not — and silence there is the feature, because guessing
    is how a rate lands on the wrong trade.
    """
    world = money_project
    lone, ambiguous, crowded = _dated_items(world, 3)

    ProjectTeamMember.objects.create(
        project=world["project"],
        name="Member",
        email="member@arribada.test",
        member=world["users"]["member"],
        roles=["firmware"],
    )
    # A second assignee makes `crowded` ambiguous whatever anybody holds.
    IssueAssignee.objects.create(
        issue=crowded,
        assignee=world["users"]["lead"],
        project=world["project"],
        workspace=world["workspace"],
    )
    ProjectTeamMember.objects.create(
        project=world["project"],
        name="Lead",
        email="lead@arribada.test",
        member=world["users"]["lead"],
        roles=["firmware", "hardware"],
    )

    url = reverse(
        "arribada-project-discipline-gap",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    body = world["clients"]["member"].get(url).data
    suggested = {row["id"]: row["suggested"] for row in body["items"]}

    assert suggested[str(lone.id)] == "firmware"
    assert suggested[str(ambiguous.id)] == "firmware"  # same lone assignee
    assert suggested[str(crowded.id)] is None, "two assignees is not an inference"


@pytest.mark.django_db
def test_baseline_list_query_count_does_not_grow_with_the_snapshots(money_project):
    """`entry_count` was a COUNT per snapshot, on an endpoint the gantt hits twice."""
    world = money_project
    issue = _dated_items(world, 1)[0]
    url = reverse(
        "arribada-project-baseline",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    client = world["clients"]["member"]

    def snapshot(name):
        row = ProjectBaseline.objects.create(project=world["project"], name=name)
        BaselineEntry.objects.create(
            baseline=row, issue=issue, issue_name=issue.name, start_date=MONDAY, target_date=FRIDAY
        )
        return row

    snapshot("PDR")
    one, _ = _count_queries(client, url)
    for n in range(6):
        snapshot(f"Amendment {n}")
    seven, body = _count_queries(client, url)

    assert len(body["baselines"]) == 7
    assert {b["entry_count"] for b in body["baselines"]} == {1}, "the count is still right"
    assert seven == one, f"{one} queries for 1 snapshot, {seven} for 7"


@pytest.mark.django_db
def test_checklist_summary_is_grouped_by_the_database(money_project):
    """A dict loop over every checklist LINE became one grouped query.

    The trap in doing that is `Meta.ordering` on `sort_order`: without an explicit
    `.order_by()` it joins the GROUP BY and every line becomes its own group, so
    the totals silently come back as ones. That is what this pins.
    """
    world = money_project
    owner, done_member, open_member = _dated_items(world, 3)
    Issue.objects.filter(id=done_member.id).update(state=world["done_state"])
    for member in (done_member, open_member):
        IssueChecklistItem.objects.create(owner=owner, member=member)

    url = reverse(
        "arribada-project-checklist-summary",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    body = world["clients"]["member"].get(url).data
    assert body["summaries"] == {str(owner.id): {"done": 1, "total": 2}}


# ── case-insensitive lookups ────────────────────────────────────────────────


@pytest.mark.django_db
def test_ci_compiles_to_lower_not_upper():
    """The one fact the whole change turns on.

    `lower(col)` is what a `UniqueConstraint(Lower("name"), ...)` builds. Django's
    `__iexact` asks for `UPPER(...)`, which no index here provides.
    """
    sql = str(_ci(ProjectDiscipline.objects.all(), "name", "Firmware").query)
    assert "LOWER(" in sql.upper().replace("UPPER(", "")  # a LOWER() is present
    assert "UPPER(" not in sql.upper(), sql


@pytest.mark.django_db
def test_ci_still_finds_a_row_stored_with_its_own_capitalisation(money_project):
    """Not `filter(name=value.lower())`, which is the tempting one-liner.

    The stored value keeps the capitalisation somebody typed. An exact match on a
    lowered needle misses "Firmware", fails to find the row it is meant to update,
    and then inserts a duplicate into a case-insensitive unique index.
    """
    world = money_project
    ProjectDiscipline.objects.create(project=world["project"], name="Firmware")
    found = _ci(ProjectDiscipline.objects.filter(project=world["project"]), "name", "FIRMWARE")
    assert found.count() == 1
    assert found.first().name == "Firmware"


@pytest.mark.django_db
def test_adding_a_discipline_that_differs_only_in_case_is_a_no_op(money_project):
    """End to end through the endpoint, both ways: found, and created."""
    world = money_project
    url = reverse(
        "arribada-project-disciplines",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    client = world["clients"]["member"]

    created = client.post(url, {"name": "Firmware"}, format="json")
    assert created.status_code == 201, created.data

    again = client.post(url, {"name": "fIrMwArE"}, format="json")
    assert again.status_code == 200, "an existing discipline is a no-op, not a second row"
    assert ProjectDiscipline.objects.filter(project=world["project"]).count() == 1


@pytest.mark.django_db
def test_saving_an_order_over_one_that_differs_only_in_case_overwrites_it(money_project):
    world = money_project
    issue = _dated_items(world, 1)[0]
    url = reverse(
        "arribada-project-orders",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    client = world["clients"]["member"]

    first = client.post(url, {"name": "Review board", "issue_ids": [str(issue.id)]}, format="json")
    assert first.status_code == 201, first.data
    second = client.post(url, {"name": "REVIEW BOARD", "issue_ids": [str(issue.id)]}, format="json")
    assert second.status_code == 200, second.data
    assert ProjectIssueOrder.objects.filter(project=world["project"]).count() == 1


@pytest.mark.django_db
def test_roster_sync_matches_an_existing_person_case_insensitively(money_project):
    """The lookup inside `TeamSyncEndpoint`'s uncapped loop.

    A roster row entered by hand as "Geoffrey.Fournier@Arribada.org" must be the
    same person the wiki pushes in lower case, or every sync creates a duplicate.
    """
    world = money_project
    ProjectTeamMember.objects.create(
        project=world["project"], name="Geoffrey Fournier", email="Geoffrey.Fournier@Arribada.org"
    )
    matched = _ci(
        ProjectTeamMember.objects.filter(project=world["project"]),
        "email",
        "geoffrey.fournier@arribada.org",
    ).first()
    assert matched is not None
    assert matched.name == "Geoffrey Fournier"


# ── DISTINCT ────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_open_repo_distinct_selects_one_column(money_project):
    """`Meta.ordering` silently joins the DISTINCT key and defeats it.

    Two open issues in ONE repo, created at different times. Without an explicit
    `.order_by()` the DISTINCT key is (repo, github_created_at) and both rows come
    back — so the set the sync builds is not a set of repos at all, and it grows
    with the number of issues rather than the number of repositories.
    """
    world = money_project
    for number, created in ((1, "2026-08-03T00:00:00Z"), (2, "2026-08-04T00:00:00Z")):
        GithubIssue.objects.create(
            workspace=world["workspace"],
            repo="arribada/linkit",
            number=number,
            title=f"#{number}",
            state="open",
            github_created_at=created,
        )

    assert repos_with_open_issues() == {"arribada/linkit"}
    # The mechanism, so the next person does not "tidy away" the `.order_by()`.
    naive = GithubIssue.objects.filter(state="open").values_list("repo", flat=True).distinct()
    assert "github_created_at" in str(naive.query)
    assert len(list(naive)) == 2, "the ordering column really does defeat the DISTINCT"
