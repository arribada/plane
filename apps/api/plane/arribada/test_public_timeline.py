# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What the public page is allowed to contain.

The risk this feature carries is not that a bar draws in the wrong place — it is
that a field nobody meant to publish rides along. So the tests that matter are
about the SHAPE of the payload, not its arithmetic: they pin the exact set of
keys, and they fail the day somebody adds a field to the builder without deciding
whether a funder should see it.

These run without a database. `_public_timeline_payload` is exercised through
fakes standing in for the querysets, because what is under test is the whitelist
and the ordering, and neither needs Postgres to be wrong.
"""

from datetime import date

import pytest


# --- what the payload may contain -------------------------------------------

# The complete, deliberate contract. Adding a key here is a decision to publish
# it; the test below fails until someone makes that decision explicitly.
ITEM_KEYS = {"name", "start_date", "target_date", "state_group", "milestone"}
PROJECT_KEYS = {"name", "start_date", "target_date"}

# Fields that live one import away in the same module and must never appear.
FORBIDDEN = {
    "assignee",
    "assignees",
    "assignee_id",
    "budget",
    "allocation",
    "expense",
    "rate",
    "estimate",
    "estimate_point",
    "priority",
    "description",
    "description_html",
    "comment",
    "artifact",
    "artifacts",
    "state",
    "state_name",
    "sequence_id",
    "project_id",
    "workspace",
    "created_by",
    "id",
    "issue_id",
}


class FakeProject:
    def __init__(self, name="Avian Tag", pid="p1", archived_at=None):
        self.id = pid
        self.name = name
        self.archived_at = archived_at


class FakeMilestone:
    def __init__(self, issue_id, kind="delivery", label=""):
        self.issue_id = issue_id
        self.kind = kind
        self.label = label


def build(monkeypatch, issues, milestones=(), schedule=None):
    """Run the real payload builder against fake querysets."""
    from plane.arribada import views

    class FakeQS:
        def __init__(self, rows):
            self._rows = rows

        def filter(self, *a, **kw):
            return self

        def values(self, *fields):
            return [{f: row.get(f) for f in fields} for row in self._rows]

        def first(self):
            return self._rows[0] if self._rows else None

        def __iter__(self):
            return iter(self._rows)

    monkeypatch.setattr(views.Issue, "issue_objects", FakeQS(issues), raising=False)
    monkeypatch.setattr(views.IssueMilestone, "objects", FakeQS(list(milestones)), raising=False)
    monkeypatch.setattr(
        views.ProjectSchedule, "objects", FakeQS([schedule] if schedule else []), raising=False
    )
    return views._public_timeline_payload(FakeProject())


def issue(pid, name, start, target, group="started"):
    return {
        "id": pid,
        "name": name,
        "start_date": start,
        "target_date": target,
        "state__group": group,
        # Deliberately present in the fake row and expected NOT to survive: the
        # builder selects its own fields, so a stray column must not ride along.
        "priority": "urgent",
        "description_html": "<p>internal only</p>",
    }


def test_item_keys_are_exactly_the_agreed_set(monkeypatch):
    payload = build(monkeypatch, [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))])
    assert set(payload["items"][0]) == ITEM_KEYS


def test_project_keys_are_exactly_the_agreed_set(monkeypatch):
    payload = build(monkeypatch, [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))])
    assert set(payload["project"]) == PROJECT_KEYS


def test_top_level_is_only_project_and_items(monkeypatch):
    payload = build(monkeypatch, [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))])
    assert set(payload) == {"project", "items"}


@pytest.mark.parametrize("field", sorted(FORBIDDEN))
def test_no_forbidden_field_anywhere_in_the_payload(monkeypatch, field):
    payload = build(
        monkeypatch,
        [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))],
        milestones=[FakeMilestone("i1")],
    )
    assert field not in payload["items"][0]
    assert field not in payload["project"]


def test_a_stray_column_on_the_row_does_not_ride_along(monkeypatch):
    """The row handed in carries priority and a description; neither is published."""
    payload = build(monkeypatch, [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))])
    assert "priority" not in payload["items"][0]
    assert "description_html" not in payload["items"][0]


# --- the funder-facing label -------------------------------------------------


def test_milestone_label_replaces_the_internal_name(monkeypatch):
    """The whole point of `label`: the internal name is not what a funder reads."""
    payload = build(
        monkeypatch,
        [issue("i1", "chase Alex re: the broken rig", date(2026, 1, 1), date(2026, 2, 1))],
        milestones=[FakeMilestone("i1", label="PDR delivered")],
    )
    assert payload["items"][0]["name"] == "PDR delivered"


def test_empty_label_falls_back_to_the_item_name(monkeypatch):
    payload = build(
        monkeypatch,
        [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))],
        milestones=[FakeMilestone("i1", label="")],
    )
    assert payload["items"][0]["name"] == "PDR"


def test_milestone_exposes_kind_and_nothing_else(monkeypatch):
    payload = build(
        monkeypatch,
        [issue("i1", "PDR", date(2026, 1, 1), date(2026, 2, 1))],
        milestones=[FakeMilestone("i1", kind="gate")],
    )
    assert payload["items"][0]["milestone"] == {"kind": "gate"}


def test_a_plain_item_has_no_milestone(monkeypatch):
    payload = build(monkeypatch, [issue("i1", "Bench test", date(2026, 1, 1), date(2026, 2, 1))])
    assert payload["items"][0]["milestone"] is None


# --- ordering ----------------------------------------------------------------


def test_items_come_out_in_date_order(monkeypatch):
    payload = build(
        monkeypatch,
        [
            issue("i3", "third", date(2026, 3, 1), date(2026, 3, 5)),
            issue("i1", "first", date(2026, 1, 1), date(2026, 1, 5)),
            issue("i2", "second", date(2026, 2, 1), date(2026, 2, 5)),
        ],
    )
    assert [i["name"] for i in payload["items"]] == ["first", "second", "third"]


def test_a_single_dated_item_sorts_on_the_date_it_has(monkeypatch):
    """Only one of the two dates is guaranteed, and the sort must not blow up on
    the missing one — an item dated by target alone still has a place in the
    order."""
    payload = build(
        monkeypatch,
        [
            issue("i2", "target only", None, date(2026, 1, 10)),
            issue("i1", "start only", date(2026, 1, 1), None),
        ],
    )
    assert [i["name"] for i in payload["items"]] == ["start only", "target only"]
