# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cost per sprint, and the three ways money falls off this chart.

The arithmetic is trivial — add labour to expenses per cycle. What is not
trivial is where a figure goes when the cycle it names is not one the reader can
see, and there are three such cases. Each of them, left alone, makes money
DISAPPEAR from a budget screen rather than merely land in the wrong row, which is
the one failure a Finance page may not have:

- a work item in no sprint at all;
- a work item whose only sprint has been soft-deleted, whose join row survives
  the delete and still names a cycle nobody can look up;
- an item counted through a LEFT JOIN, which returns a null cycle key rather than
  no row, so a naive "total minus what the sprints claim" reads zero.

No database: the two managers are replaced with fakes shaped like the two
querysets the function actually builds.

Run explicitly: `python -m pytest plane/arribada/test_cost_by_cycle.py`
"""

from datetime import datetime, timezone

from plane.arribada import views


class FakeCycles:
    """`Cycle.objects.filter(...).order_by(...).values(...)`."""

    def __init__(self, rows):
        self._rows = rows

    def filter(self, **_):
        return self

    def order_by(self, *_):
        return self

    def values(self, *_):
        return list(self._rows)


class FakeIssues:
    """`Issue.issue_objects.filter(...).values(...).annotate(...)`.

    The grouped counts are handed over ready-made; what is under test is what the
    function does with a null key and with a key naming no live cycle.
    """

    def __init__(self, groups):
        self._groups = groups

    def filter(self, **_):
        return self

    def values(self, *_):
        return self

    def annotate(self, **_):
        return [{"issue_cycle__cycle_id": key, "n": n} for key, n in self._groups]


def build(monkeypatch, cycles, groups, labour=None, expense=None, currency="EUR", unconvertible=()):
    monkeypatch.setattr(views.Cycle, "objects", FakeCycles(cycles), raising=False)
    monkeypatch.setattr(views.Issue, "issue_objects", FakeIssues(groups), raising=False)
    return views._cost_by_cycle(
        "p1", dict(labour or {}), dict(expense or {}), currency, list(unconvertible)
    )


def cycle(id, name="Sprint", start=None, end=None, archived=None):
    return {
        "id": id,
        "name": name,
        "start_date": datetime(*start, tzinfo=timezone.utc) if start else None,
        "end_date": datetime(*end, tzinfo=timezone.utc) if end else None,
        "archived_at": archived,
    }


def row(payload, cycle_id):
    return next(r for r in payload["cycles"] if r["cycle_id"] == cycle_id)


# --- the ordinary reading ----------------------------------------------------


def test_a_sprint_reports_both_halves_and_their_sum(monkeypatch):
    payload = build(
        monkeypatch,
        [cycle("c1", "Sprint 1", start=(2026, 1, 1), end=(2026, 2, 28))],
        [("c1", 4)],
        labour={"c1": 1200.0},
        expense={"c1": 300.5},
    )
    first = row(payload, "c1")
    assert (first["labour"], first["expense"], first["amount"]) == (1200.0, 300.5, 1500.5)
    assert first["items"] == 4
    assert (first["start_date"], first["end_date"]) == ("2026-01-01", "2026-02-28")


def test_a_sprint_with_no_cost_keeps_its_row(monkeypatch):
    """It is not an empty sprint — it is a sprint whose items carry no dates, no
    discipline or no rate, and a row that vanished would read as neither."""
    payload = build(monkeypatch, [cycle("c1")], [("c1", 9)])
    assert row(payload, "c1")["amount"] == 0
    assert row(payload, "c1")["items"] == 9


def test_cycles_keep_the_order_the_query_gave_them(monkeypatch):
    payload = build(
        monkeypatch,
        [cycle("c1", "First", start=(2026, 1, 1)), cycle("c2", "Second", start=(2026, 3, 1))],
        [("c1", 1), ("c2", 1)],
    )
    assert [r["name"] for r in payload["cycles"]] == ["First", "Second"]


# --- the three ways money leaves the chart -----------------------------------


def test_work_in_no_sprint_gets_its_own_row(monkeypatch):
    """The reason this feature exists. It is never folded into a total."""
    payload = build(monkeypatch, [cycle("c1")], [("c1", 2), (None, 3)], labour={None: 800.0})
    loose = row(payload, None)
    assert loose["name"] == "Not in any sprint"
    assert loose["labour"] == 800.0
    assert loose["items"] == 3


def test_a_deleted_cycle_hands_its_money_to_the_unsprinted_row(monkeypatch):
    """A soft-deleted cycle leaves its join rows behind. Its cost must land
    somewhere a reader can see, and there is no row for a cycle that is gone."""
    payload = build(
        monkeypatch,
        [cycle("c1")],
        [("c1", 1), ("gone", 4)],
        labour={"c1": 100.0, "gone": 250.0},
        expense={"gone": 50.0},
    )
    assert row(payload, "c1")["amount"] == 100.0
    loose = row(payload, None)
    assert (loose["labour"], loose["expense"], loose["items"]) == (250.0, 50.0, 4)


def test_nothing_loose_means_no_unsprinted_row(monkeypatch):
    payload = build(monkeypatch, [cycle("c1")], [("c1", 3)], labour={"c1": 10.0})
    assert all(r["cycle_id"] is not None for r in payload["cycles"])


def test_the_unsprinted_row_appears_for_items_alone(monkeypatch):
    """Items with no cost still say "nobody is reviewing this"."""
    payload = build(monkeypatch, [cycle("c1")], [("c1", 1), (None, 7)])
    assert row(payload, None)["items"] == 7


def test_every_figure_lands_in_exactly_one_row(monkeypatch):
    """The property that matters: the rows add up to what went in. A budget
    screen may put money in the wrong row; it may not lose it."""
    payload = build(
        monkeypatch,
        [cycle("c1"), cycle("c2")],
        [("c1", 1), ("c2", 1), (None, 1), ("gone", 1)],
        labour={"c1": 1000.0, "c2": 2000.0, None: 30.0, "gone": 7.0},
        expense={"c1": 5.0, "gone": 3.0},
    )
    assert round(sum(r["amount"] for r in payload["cycles"]), 2) == 3045.0


# --- what travels beside the figures -----------------------------------------


def test_an_archived_cycle_is_kept_and_flagged(monkeypatch):
    """Money it consumed was still spent. Dropping it would silently reclassify
    that cost as unsprinted, which is a different and false statement."""
    payload = build(
        monkeypatch,
        [cycle("c1", archived=datetime(2026, 5, 1, tzinfo=timezone.utc))],
        [("c1", 2)],
        labour={"c1": 400.0},
    )
    assert row(payload, "c1")["archived"] is True
    assert row(payload, "c1")["amount"] == 400.0


def test_the_currency_and_the_gaps_travel_with_the_figures(monkeypatch):
    payload = build(monkeypatch, [cycle("c1")], [("c1", 1)], currency="GBP", unconvertible=["USD"])
    assert payload["currency"] == "GBP"
    assert payload["unconvertible"] == ["USD"]


def test_a_project_with_no_cycles_reports_only_what_is_loose(monkeypatch):
    payload = build(monkeypatch, [], [(None, 37)], labour={None: 102141.18})
    assert len(payload["cycles"]) == 1
    assert payload["cycles"][0]["cycle_id"] is None
    assert payload["cycles"][0]["amount"] == 102141.18


def test_a_project_with_nothing_at_all_draws_nothing(monkeypatch):
    assert build(monkeypatch, [], [])["cycles"] == []
