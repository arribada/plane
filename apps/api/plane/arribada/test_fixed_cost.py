# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A work item that is bought rather than done.

Two pieces of arithmetic sit under the feature and both are easy to get quietly
wrong later.

The first is which of several ledger lines the work item panel shows. A panel
that picked a different row depending on query ordering would look like it had
lost somebody's number, and the row it picks is the one whose flag decides
whether the item is costed as labour at all.

The second is that a supplier's lead time is CALENDAR days. Everywhere else in
this app a number of days means working days, so the temptation to "fix" this
function by skipping weekends is permanent — and a factory in Shenzhen does not
observe our Saturdays. Six weeks is forty-two days.

No database: both are pure functions over attributes and dates.

Run explicitly: `python -m pytest plane/arribada/test_fixed_cost.py`
"""

from datetime import date

from plane.arribada.views import _primary_fixed_cost, _target_from_lead_time


class Line:
    """Just enough of a ProjectExpense for the chooser to sort."""

    def __init__(self, id, total, replaces_labour):
        self.id = id
        self.total = total
        self.replaces_labour = replaces_labour


# --- which line the panel shows ---------------------------------------------


def test_nothing_recorded_is_nothing_to_edit():
    assert _primary_fixed_cost([]) is None


def test_the_line_that_replaces_labour_wins():
    """Even against a bigger one. It is the flag, not the amount, that changes
    what the item costs in the budget and in everybody's capacity."""
    parts = Line("a", 9000, False)
    build = Line("b", 4000, True)
    assert _primary_fixed_cost([parts, build]) is build


def test_otherwise_the_largest_wins():
    """A build and its shipping: the build is what the item is."""
    shipping = Line("a", 120, False)
    build = Line("b", 4000, False)
    assert _primary_fixed_cost([shipping, build]) is build


def test_the_choice_does_not_depend_on_the_order_it_arrives_in():
    rows = [Line("a", 4000, False), Line("b", 4000, False)]
    assert _primary_fixed_cost(rows).id == _primary_fixed_cost(list(reversed(rows))).id


# --- what a quoted lead time implies ----------------------------------------

# A Monday, so a six-week wait lands somewhere predictable.
MONDAY = date(2027, 3, 1)


def test_no_lead_time_offers_nothing():
    assert _target_from_lead_time({"start_date": MONDAY, "target_date": None}, None) is None


def test_a_lead_time_is_calendar_days_not_working_days():
    """Six weeks from a Monday is the Monday six weeks later — 42 days, weekends
    included. Counting working days would land three weeks late."""
    assert _target_from_lead_time({"start_date": MONDAY, "target_date": None}, 42) == "2027-04-12"


def test_a_landing_on_a_weekend_moves_to_the_monday():
    """The factory works Saturdays; the plan does not have to end on one."""
    # MONDAY + 5 days is a Saturday.
    assert _target_from_lead_time({"start_date": MONDAY, "target_date": None}, 5) == "2027-03-08"


def test_an_item_that_already_has_a_target_is_left_alone():
    """A date somebody typed has been decided. Offering to replace it is noise."""
    issue = {"start_date": MONDAY, "target_date": date(2027, 5, 1)}
    assert _target_from_lead_time(issue, 42) is None
