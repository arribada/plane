# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The setup planner's float figures, for the two shapes a dependency can take.

`after` on a planned task is either a bare predecessor key or an object —
`{"key": "hw.layout", "lag": 5, "type": "SS"}` — and `schedule` has accepted
both since lags and start-to-start links were added. `compute_float` had not
caught up: it tested each entry with `pred in placed`, which for a dict is a
`TypeError`, so every plan containing one object-form link answered 500 from the
setup planner while the placement itself had worked.

The second half is what the figures SAY once they no longer crash. The dates
were placed honouring the lag and the kind, so the float has to as well: a
mandatory five-day gap is not five days of slack, and a start-to-start link
bounds a start rather than a finish.

Pure functions, no database.

Run explicitly: `python -m pytest plane/arribada/test_blueprint_float_links.py`
"""

from datetime import date

from plane.arribada.blueprints import compute_float, schedule

D = date
KICKOFF = D(2026, 8, 3)  # a Monday


def _plan(after_for_b):
    tasks = [
        {"key": "a", "name": "A", "role": "firmware", "days": 5, "after": []},
        {"key": "b", "name": "B", "role": "firmware", "days": 5, "after": after_for_b},
    ]
    placed, _warnings = schedule(tasks, KICKOFF, {"firmware": 2}, [], {}, frozenset())
    return tasks, placed


def test_an_object_form_dependency_does_not_crash_the_float():
    """The 500. `{"key": ...} in placed` raised TypeError: unhashable type."""
    tasks, placed = _plan([{"key": "a", "lag": 0, "type": "FS"}])
    slack = compute_float(tasks, placed)
    assert set(slack) == {"a", "b"}


def test_an_object_form_link_reads_the_same_as_the_bare_key_it_spells():
    bare_tasks, bare_placed = _plan(["a"])
    obj_tasks, obj_placed = _plan([{"key": "a"}])
    assert bare_placed == obj_placed
    assert compute_float(bare_tasks, bare_placed) == compute_float(obj_tasks, obj_placed)


def test_a_lag_is_placed_and_is_not_reported_as_slack():
    """Five working days after A, by the link. The placement leaves the gap; the
    float must not then offer it back as room to slip."""
    tasks, placed = _plan([{"key": "a", "lag": 5, "type": "FS"}])
    assert placed["a"]["target"] == D(2026, 8, 7)
    assert placed["b"]["start"] == D(2026, 8, 17), "the lag was not placed"

    slack = compute_float(tasks, placed)
    assert slack["a"]["total"] == 0, "a mandatory gap was reported as float"
    assert slack["a"]["critical"] is True


def test_a_start_to_start_link_bounds_the_start_not_the_finish():
    """B may begin the day A does. A ten-day A beside a five-day B: A is the
    longer and ends the plan, so A is critical and B has the rest of A to slip in."""
    tasks = [
        {"key": "a", "name": "A", "role": "firmware", "days": 10, "after": []},
        {"key": "b", "name": "B", "role": "hardware", "days": 5, "after": [{"key": "a", "type": "SS"}]},
    ]
    placed, _warnings = schedule(tasks, KICKOFF, {"firmware": 1, "hardware": 1}, [], {}, frozenset())
    assert placed["b"]["start"] == placed["a"]["start"] == KICKOFF

    slack = compute_float(tasks, placed)
    assert slack["a"] == {"free": 0, "total": 0, "critical": True}
    assert slack["b"]["total"] == 5
    assert slack["b"]["critical"] is False


def test_a_link_to_a_key_that_was_not_placed_is_ignored():
    tasks, placed = _plan([{"key": "ghost"}, "a"])
    slack = compute_float(tasks, placed)
    assert slack["a"]["critical"] is True
