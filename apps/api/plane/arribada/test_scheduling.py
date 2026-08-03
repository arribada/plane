# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Pure-function tests for the scheduling engine — no Django/DB needed.
# Run: python -m pytest plane/arribada/tests_scheduling.py

import datetime as dt

from plane.arribada.scheduling import cascade, critical_path

D = dt.date


def _graph():
    issues = {
        "A": {"start": D(2026, 8, 1), "target": D(2026, 8, 5)},
        "B": {"start": D(2026, 8, 3), "target": D(2026, 8, 7)},  # violates A finish_before B
        "C": {"start": D(2026, 8, 4), "target": D(2026, 8, 6)},
    }
    rels = [
        {"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"},
        {"issue_id": "B", "related_issue_id": "C", "relation_type": "finish_before"},
    ]
    return issues, rels


def test_cascade_pushes_and_preserves_duration():
    """B originally runs Mon 3 to Fri 7 August — five working days.

    Both assertions below were stale and this test had been red since cascade
    learned about weekends. The old ones read `.days == 4` and a C start of 11
    August, which are the answers a cascade that steps over Saturdays cannot give:
    B is pushed to Thu 6 and needs its five working days, so it ends Wed 12, and C
    follows on Thu 13. Counting CALENDAR days was the mistake — it asks the
    scheduler to either shorten the work or start somebody on a Saturday.
    """
    issues, rels = _graph()
    changed = cascade(issues, rels)
    assert changed["B"]["start"] == D(2026, 8, 6)  # A target 8/5 + 1

    span = [
        changed["B"]["start"] + dt.timedelta(days=i)
        for i in range((changed["B"]["target"] - changed["B"]["start"]).days + 1)
    ]
    assert len([d for d in span if d.weekday() < 5]) == 5  # working duration kept
    assert changed["B"]["target"] == D(2026, 8, 12)

    assert changed["C"]["start"] == D(2026, 8, 13)  # propagated after new B target


def test_cascade_never_pulls_earlier():
    issues = {
        "A": {"start": D(2026, 8, 1), "target": D(2026, 8, 5)},
        "B": {"start": D(2026, 9, 1), "target": D(2026, 9, 5)},  # already after A
    }
    rels = [{"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"}]
    assert cascade(issues, rels) == {}  # nothing to move


def test_critical_path_is_full_chain():
    issues, rels = _graph()
    assert critical_path(issues, rels) == {"A", "B", "C"}


def test_cycle_is_safe():
    issues, rels = _graph()
    cyc = [
        {"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"},
        {"issue_id": "B", "related_issue_id": "A", "relation_type": "finish_before"},
    ]
    assert cascade(issues, cyc) == {}  # no hang, cycle nodes dropped
    critical_path(issues, cyc)  # no hang
