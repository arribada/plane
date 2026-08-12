# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What a portfolio work item has to carry for the board to band by it.

The portfolio can now subgroup a project's items by sprint, module or discipline
— the same axes, and the same words, as the work-item timeline's own Group
control. None of those three were in this payload. An item that does not carry
the field it is being banded by can only ever land in the "unset" band, and a
board where every row says "No module" looks like a project nobody has organised
rather than like a screen asking the wrong question.

The query-count test is the other half. Three axes could easily have been three
lookups per row, and this endpoint returns up to 500 of them; the rule is the one
the rest of this suite uses — the count must not grow with the rows, rather than
be some particular number that gets raised instead of read.

Run explicitly: `python -m pytest plane/arribada/test_portfolio_items.py`
"""

from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from plane.arribada.models import IssueRole
from plane.db.models import Cycle, CycleIssue, Issue, Module, ModuleIssue

MONDAY = date(2026, 8, 3)
FRIDAY = date(2026, 8, 7)


def _items(world, count):
    return [
        Issue.objects.create(
            name=f"Item {n}",
            project=world["project"],
            workspace=world["workspace"],
            state=world["state"],
            start_date=MONDAY,
            target_date=FRIDAY,
            created_by=world["users"]["owner"],
        )
        for n in range(count)
    ]


def _module(world, name):
    return Module.objects.create(
        name=name, project=world["project"], workspace=world["workspace"], created_by=world["users"]["owner"]
    )


def _url(world):
    return reverse(
        "arribada-portfolio-items",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


@pytest.mark.django_db
def test_an_item_carries_the_axes_the_portfolio_bands_by(money_project):
    world = money_project
    issue = _items(world, 1)[0]

    sprint = Cycle.objects.create(
        name="Sprint 4", project=world["project"], workspace=world["workspace"], owned_by=world["users"]["owner"]
    )
    CycleIssue.objects.create(
        cycle=sprint, issue=issue, project=world["project"], workspace=world["workspace"]
    )
    module = _module(world, "Firmware")
    ModuleIssue.objects.create(
        module=module, issue=issue, project=world["project"], workspace=world["workspace"]
    )
    IssueRole.objects.create(issue=issue, role="firmware")

    response = world["clients"]["member"].get(_url(world))
    assert response.status_code == 200, response.data
    row = response.data[0]

    assert row["cycle"] == {"id": str(sprint.id), "name": "Sprint 4"}
    assert row["module"] == {"id": str(module.id), "name": "Firmware"}
    assert row["disciplines"] == ["firmware"]


@pytest.mark.django_db
def test_an_item_in_no_sprint_or_module_says_so_rather_than_omitting_the_field(money_project):
    """A missing key and an empty one read the same to a client that uses `?.`,
    but only one of them survives a strict type. The band wants an explicit null."""
    world = money_project
    _items(world, 1)

    row = world["clients"]["member"].get(_url(world)).data[0]

    assert row["cycle"] is None
    assert row["module"] is None
    assert row["disciplines"] == []


@pytest.mark.django_db
def test_a_multi_module_item_reports_the_one_the_timeline_would_have_picked(money_project):
    """An item can be in several modules and can only be drawn on one row.

    The work-item timeline files it under its lowest-named module; the portfolio
    has to agree, or the same item sits in Firmware on one screen and Hardware on
    the other.
    """
    world = money_project
    issue = _items(world, 1)[0]
    for name in ("Software", "Hardware", "Firmware"):
        ModuleIssue.objects.create(
            module=_module(world, name),
            issue=issue,
            project=world["project"],
            workspace=world["workspace"],
        )

    row = world["clients"]["member"].get(_url(world)).data[0]
    assert row["module"]["name"] == "Firmware"


@pytest.mark.django_db
def test_the_query_count_does_not_grow_with_the_rows(money_project):
    """Three new axes, three bulk queries — not three per row.

    Measured as a difference between two row counts rather than as a fixed
    number: a fixed number fails on the next unrelated `select_related` and gets
    raised rather than read.
    """
    world = money_project
    client = world["clients"]["member"]

    made = 0

    def _count(n):
        nonlocal made
        for issue in _items(world, n):
            made += 1
            # A distinct module per item, named from a counter rather than from
            # the issue: `sequence_id` is not unique in a bare fixture, and a
            # duplicate module name per project is a constraint away from a
            # confusing IntegrityError inside a query-count test.
            ModuleIssue.objects.create(
                module=_module(world, f"M{made}"),
                issue=issue,
                project=world["project"],
                workspace=world["workspace"],
            )
            IssueRole.objects.create(issue=issue, role="firmware")
        with CaptureQueriesContext(connection) as captured:
            response = client.get(_url(world))
        assert response.status_code == 200
        return len(captured)

    small = _count(3)
    large = _count(20)
    assert large <= small, f"the endpoint costs more per row: {small} queries for 3, {large} for 23"
