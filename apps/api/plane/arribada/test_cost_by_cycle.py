# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cost per sprint, and the three ways money falls off this chart.

THIS FILE USED TO REPLACE BOTH QUERYSETS WITH FAKES. `Cycle.objects` and
`Issue.issue_objects` were monkeypatched with small stand-ins shaped like the two
queries the function builds, and everything below was then asserted against those
stand-ins. It passed, and it went on passing while the real `Issue.issue_objects`
quietly dropped every archived work item — so a finished sprint reported its cost
against zero items, and nothing here could see it, because the fake had no
concept of archiving to get wrong.

The arithmetic really is trivial: add labour to expenses per cycle. What is not
trivial is which rows the two queries return, and that is exactly the part a fake
cannot test. So the cycles are real rows now, the join rows are real, and the
soft-deleted cycle is genuinely soft-deleted.

The three cases, each of which makes money DISAPPEAR from a budget screen rather
than merely land in the wrong row — the one failure a Finance page may not have:

- a work item in no sprint at all;
- a work item whose only sprint has been soft-deleted, whose join row survives
  the delete and still names a cycle nobody can look up;
- an item counted through a LEFT JOIN, which returns a null cycle key rather than
  no row, so a naive "total minus what the sprints claim" reads zero.

`labour_by_cycle` and `expense_by_cycle` are still passed in directly. Those are
the function's inputs — computed by `ProjectBudgetEndpoint` from the tasks and
the ledger — and `test_budget_endpoint.py` is where they come under test.

Run explicitly: `python -m pytest plane/arribada/test_cost_by_cycle.py`
"""

from datetime import datetime, timezone as tz

import pytest
from django.utils import timezone

from plane.arribada import views
from plane.db.models import Cycle, CycleIssue, Issue


@pytest.fixture
def sprints(money_project):
    """A helper bundle over the real project, so each test states only its own shape."""

    def cycle(name, start=None, end=None, archived=False, deleted=False):
        row = Cycle.objects.create(
            name=name,
            project=money_project["project"],
            workspace=money_project["workspace"],
            owned_by=money_project["users"]["owner"],
            start_date=datetime(*start, tzinfo=tz.utc) if start else None,
            end_date=datetime(*end, tzinfo=tz.utc) if end else None,
            archived_at=timezone.now() if archived else None,
        )
        if deleted:
            # Soft-deleted through the manager's own path, so this is the state a
            # human deleting a sprint in the UI actually leaves behind: the cycle is
            # gone from every query and its join rows are not.
            Cycle.objects.filter(id=row.id).update(deleted_at=timezone.now())
        return row

    def item(name, in_cycle=None, archived=False, draft=False, state=None):
        issue = Issue.objects.create(
            name=name,
            project=money_project["project"],
            workspace=money_project["workspace"],
            state=state or money_project["state"],
            created_by=money_project["users"]["owner"],
            is_draft=draft,
        )
        if archived:
            Issue.objects.filter(id=issue.id).update(archived_at=timezone.now())
        if in_cycle is not None:
            CycleIssue.objects.create(
                cycle=in_cycle,
                issue=issue,
                project=money_project["project"],
                workspace=money_project["workspace"],
            )
        return issue

    money_project["cycle"] = cycle
    money_project["item"] = item
    return money_project


def cost(world, labour=None, expense=None, currency="EUR", unconvertible=()):
    return views._cost_by_cycle(
        world["project"].id, dict(labour or {}), dict(expense or {}), currency, list(unconvertible)
    )


def row(payload, cycle_id):
    """`cycle_id` comes back stringified — a client keys on it and routes with it."""
    wanted = None if cycle_id is None else str(cycle_id)
    return next(r for r in payload["cycles"] if r["cycle_id"] == wanted)


# --- the ordinary reading ----------------------------------------------------


def test_a_sprint_reports_both_halves_and_their_sum(sprints):
    first = sprints["cycle"]("Sprint 1", start=(2026, 1, 1), end=(2026, 2, 28))
    for i in range(4):
        sprints["item"](f"Item {i}", in_cycle=first)

    payload = cost(sprints, labour={first.id: 1200.0}, expense={first.id: 300.5})
    got = row(payload, first.id)
    assert (got["labour"], got["expense"], got["amount"]) == (1200.0, 300.5, 1500.5)
    assert got["items"] == 4
    assert (got["start_date"], got["end_date"]) == ("2026-01-01", "2026-02-28")


def test_a_sprint_with_no_cost_keeps_its_row(sprints):
    """It is not an empty sprint — it is a sprint whose items carry no dates, no
    discipline or no rate, and a row that vanished would read as neither."""
    first = sprints["cycle"]("Sprint 1")
    for i in range(9):
        sprints["item"](f"Item {i}", in_cycle=first)

    payload = cost(sprints)
    assert row(payload, first.id)["amount"] == 0
    assert row(payload, first.id)["items"] == 9


def test_cycles_keep_the_order_the_query_gave_them(sprints):
    sprints["cycle"]("First", start=(2026, 1, 1))
    sprints["cycle"]("Second", start=(2026, 3, 1))
    assert [r["name"] for r in cost(sprints)["cycles"]] == ["First", "Second"]


# --- the three ways money leaves the chart -----------------------------------


def test_work_in_no_sprint_gets_its_own_row(sprints):
    """The reason this feature exists. It is never folded into a total."""
    first = sprints["cycle"]("Sprint 1")
    sprints["item"]("In the sprint", in_cycle=first)
    sprints["item"]("Loose one")
    sprints["item"]("Loose two")
    sprints["item"]("Loose three")

    payload = cost(sprints, labour={None: 800.0})
    loose = row(payload, None)
    assert loose["name"] == "Not in any sprint"
    assert loose["labour"] == 800.0
    assert loose["items"] == 3


def test_a_deleted_cycle_hands_its_money_to_the_unsprinted_row(sprints):
    """A soft-deleted cycle leaves its join rows behind. Its cost must land
    somewhere a reader can see, and there is no row for a cycle that is gone."""
    live = sprints["cycle"]("Sprint 1")
    gone = sprints["cycle"]("Deleted", deleted=True)
    sprints["item"]("Kept", in_cycle=live)
    for i in range(4):
        sprints["item"](f"Orphan {i}", in_cycle=gone)

    payload = cost(sprints, labour={live.id: 100.0, gone.id: 250.0}, expense={gone.id: 50.0})
    assert row(payload, live.id)["amount"] == 100.0
    loose = row(payload, None)
    assert (loose["labour"], loose["expense"], loose["items"]) == (250.0, 50.0, 4)


def test_nothing_loose_means_no_unsprinted_row(sprints):
    first = sprints["cycle"]("Sprint 1")
    for i in range(3):
        sprints["item"](f"Item {i}", in_cycle=first)
    payload = cost(sprints, labour={first.id: 10.0})
    assert all(r["cycle_id"] is not None for r in payload["cycles"])


def test_the_unsprinted_row_appears_for_items_alone(sprints):
    """Items with no cost still say "nobody is reviewing this"."""
    first = sprints["cycle"]("Sprint 1")
    sprints["item"]("In it", in_cycle=first)
    for i in range(7):
        sprints["item"](f"Loose {i}")
    assert row(cost(sprints), None)["items"] == 7


def test_every_figure_lands_in_exactly_one_row(sprints):
    """The property that matters: the rows add up to what went in. A budget
    screen may put money in the wrong row; it may not lose it."""
    one = sprints["cycle"]("One")
    two = sprints["cycle"]("Two")
    gone = sprints["cycle"]("Gone", deleted=True)
    sprints["item"]("a", in_cycle=one)
    sprints["item"]("b", in_cycle=two)
    sprints["item"]("c")
    sprints["item"]("d", in_cycle=gone)

    payload = cost(
        sprints,
        labour={one.id: 1000.0, two.id: 2000.0, None: 30.0, gone.id: 7.0},
        expense={one.id: 5.0, gone.id: 3.0},
    )
    assert round(sum(r["amount"] for r in payload["cycles"]), 2) == 3045.0


# --- which work items are counted --------------------------------------------


def test_an_archived_item_is_still_in_its_sprint(sprints):
    """The row the old fakes could not have: `Issue.issue_objects` drops archived
    items, and completed items are archived automatically once a project sets
    `archive_in`. Counting from it meant a finished sprint reported its cost
    against zero items."""
    first = sprints["cycle"]("Sprint 1")
    sprints["item"]("Live", in_cycle=first)
    sprints["item"]("Finished and filed", in_cycle=first, archived=True)

    payload = cost(sprints, labour={first.id: 400.0})
    assert row(payload, first.id)["items"] == 2, (
        "an archived work item left the sprint it was delivered in, while the money it "
        "cost stayed on the chart"
    )


def test_a_draft_is_not_in_any_sprint(sprints):
    """Excluded, unlike an archived item. Nobody has committed to a draft."""
    first = sprints["cycle"]("Sprint 1")
    sprints["item"]("Real", in_cycle=first)
    sprints["item"]("Half typed", in_cycle=first, draft=True)
    assert row(cost(sprints), first.id)["items"] == 1


# --- what travels beside the figures -----------------------------------------


def test_an_archived_cycle_is_kept_and_flagged(sprints):
    """Money it consumed was still spent. Dropping it would silently reclassify
    that cost as unsprinted, which is a different and false statement."""
    first = sprints["cycle"]("Sprint 1", archived=True)
    sprints["item"]("a", in_cycle=first)
    sprints["item"]("b", in_cycle=first)

    payload = cost(sprints, labour={first.id: 400.0})
    assert row(payload, first.id)["archived"] is True
    assert row(payload, first.id)["amount"] == 400.0


def test_the_currency_and_the_gaps_travel_with_the_figures(sprints):
    first = sprints["cycle"]("Sprint 1")
    sprints["item"]("a", in_cycle=first)
    payload = cost(sprints, currency="GBP", unconvertible=["USD"])
    assert payload["currency"] == "GBP"
    assert payload["unconvertible"] == ["USD"]


def test_a_project_with_no_cycles_reports_only_what_is_loose(sprints):
    for i in range(37):
        sprints["item"](f"Loose {i}")
    payload = cost(sprints, labour={None: 102141.18})
    assert len(payload["cycles"]) == 1
    assert payload["cycles"][0]["cycle_id"] is None
    assert payload["cycles"][0]["amount"] == 102141.18


def test_a_project_with_nothing_at_all_draws_nothing(sprints):
    assert cost(sprints)["cycles"] == []


def test_another_projects_sprints_are_not_on_this_chart(sprints):
    """Scoping, which a fake `filter(**_)` that returned everything it was given
    could not have tested at all."""
    from plane.db.models import Project

    other = Project.objects.create(
        name="Elsewhere",
        workspace=sprints["workspace"],
        created_by=sprints["users"]["owner"],
        identifier="ELS",
    )
    Cycle.objects.create(
        name="Not ours",
        project=other,
        workspace=sprints["workspace"],
        owned_by=sprints["users"]["owner"],
    )
    mine = sprints["cycle"]("Ours")
    sprints["item"]("a", in_cycle=mine)
    assert [r["name"] for r in cost(sprints)["cycles"]] == ["Ours"]
