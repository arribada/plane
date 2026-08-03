# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The delivery floor: a task cannot start before the part it needs arrives.

Pure — `cascade` takes dates and returns dates, so none of this needs a database.
Run explicitly: `python -m pytest plane/arribada/tests_delivery_floors.py`
(pytest.ini's python_files does not collect a tests_*.py name).

The case that matters most is the last one: a floor must do NOTHING unless the
project asked for it. That is a decision about trust, not about arithmetic — a
planner that moves somebody's dates because a colleague typed a supplier's
promise into a form is one nobody uses twice.
"""

from datetime import date

from plane.arribada.scheduling import cascade

MON = date(2027, 3, 1)  # a Monday
TUE = date(2027, 3, 2)
FRI = date(2027, 3, 5)


def test_a_task_with_no_predecessors_still_waits_for_its_part():
    """The simplest case there is, and the one an implementation gets wrong: an
    item waiting only on a delivery has no predecessors, so a floor applied after
    the "no constraints, skip" check would never fire."""
    issues = {"A": {"start": MON, "target": FRI}}
    changed = cascade(issues, [], earliest_starts={"A": date(2027, 3, 15)})
    assert changed["A"]["start"] == date(2027, 3, 15)
    # Duration is preserved: five calendar days from Monday to Friday.
    assert changed["A"]["target"] == date(2027, 3, 19)


def test_no_floor_means_nothing_moves():
    issues = {"A": {"start": MON, "target": FRI}}
    assert cascade(issues, [], earliest_starts={}) == {}
    assert cascade(issues, []) == {}


def test_a_floor_in_the_past_never_pulls_a_task_earlier():
    """cascade only ever pushes later. A part that arrived last month does not
    entitle the plan to start last month."""
    issues = {"A": {"start": date(2027, 3, 15), "target": date(2027, 3, 19)}}
    assert cascade(issues, [], earliest_starts={"A": MON}) == {}


def test_the_later_of_a_predecessor_and_a_delivery_wins():
    """Both constraints apply; the task waits for whichever is later."""
    issues = {
        "A": {"start": MON, "target": TUE},
        "B": {"start": MON, "target": FRI},
    }
    relations = [{"issue_id": "B", "related_issue_id": "A", "relation_type": "blocked_by"}]

    # Predecessor finishes Tue, so B would start Wed. The part lands 22 March.
    late_part = cascade(issues, relations, earliest_starts={"B": date(2027, 3, 22)})
    assert late_part["B"]["start"] == date(2027, 3, 22)

    # Same graph, part already on the bench: the predecessor is what B waits for.
    early_part = cascade(issues, relations, earliest_starts={"B": date(2027, 1, 4)})
    assert early_part["B"]["start"] == date(2027, 3, 3)


def test_a_floor_landing_on_a_weekend_starts_the_next_working_day():
    """Saturday 2027-03-06. Nobody starts work on a delivery that lands then."""
    issues = {"A": {"start": MON, "target": FRI}}
    changed = cascade(issues, [], earliest_starts={"A": date(2027, 3, 6)})
    assert changed["A"]["start"] == date(2027, 3, 8)  # the Monday


def test_a_delayed_part_pushes_everything_downstream_of_it():
    """The point of doing this inside cascade rather than beside it: the floor
    joins the same forward pass, so a late delivery moves the whole chain."""
    issues = {
        "A": {"start": MON, "target": TUE},
        "B": {"start": date(2027, 3, 3), "target": date(2027, 3, 4)},
        "C": {"start": date(2027, 3, 5), "target": FRI},
    }
    relations = [
        {"issue_id": "B", "related_issue_id": "A", "relation_type": "blocked_by"},
        {"issue_id": "C", "related_issue_id": "B", "relation_type": "blocked_by"},
    ]
    changed = cascade(issues, relations, earliest_starts={"A": date(2027, 3, 15)})
    assert changed["A"]["start"] == date(2027, 3, 15)
    assert changed["B"]["start"] > changed["A"]["target"]
    assert changed["C"]["start"] > changed["B"]["target"]


def test_a_floor_on_an_undated_item_is_ignored():
    """cascade only reasons about items with both dates; an undated one has no
    span to move and must not be invented one."""
    issues = {"A": {"start": None, "target": None}}
    assert cascade(issues, [], earliest_starts={"A": date(2027, 3, 15)}) == {}
