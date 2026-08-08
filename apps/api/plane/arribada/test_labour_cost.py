# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Days x hours-per-day x hourly rate, and every place that goes wrong.

`_labour_cost` produces the largest number on the Finance page and the largest
number in the annex a funder receives, on projects whose cost is almost entirely
people — which is nearly all of them here. It had no tests.

It is pure: a list of `{role, days}` and a rate map in, a breakdown out. So this
file needs no database, unlike `test_budget_endpoint.py`, which covers the
querysets that build that list.

Two policies are worth stating because both look like bugs from the outside and
neither is:

- currencies are NOT summed. A subcontractor billed in dollars beside a salaried
  engineer costed in euros has no meaningful total, and inventing one would be
  worse than showing two numbers. The endpoint converts separately, names what it
  could not reach, and marks the result approximate.
- a row with no rate keeps its DAYS. The gap is then visible on the page instead
  of the discipline silently vanishing from the estimate.

Run explicitly: `python -m pytest plane/arribada/test_labour_cost.py`
"""

from plane.arribada.views import _labour_cost

# £100/hour, 7-hour day: one person-day is £700.
GBP = {"firmware": {"hourly_rate": 100.0, "hours_per_day": 7.0, "currency": "GBP"}}
TWO = {
    "firmware": {"hourly_rate": 100.0, "hours_per_day": 7.0, "currency": "GBP"},
    "hardware": {"hourly_rate": 50.0, "hours_per_day": 8.0, "currency": "EUR"},
}


def task(role, days):
    return {"role": role, "days": days}


def test_a_day_costs_its_rate():
    out = _labour_cost([task("firmware", 1)], GBP)
    assert out["totals"] == [{"currency": "GBP", "amount": 700.0}]
    assert out["by_role"][0]["hours"] == 7.0


def test_days_of_the_same_discipline_are_added():
    out = _labour_cost([task("firmware", 2), task("firmware", 3)], GBP)
    assert out["by_role"] == [
        {"role": "firmware", "days": 5, "hours": 35.0, "cost": 3500.0, "currency": "GBP", "rated": True}
    ]


def test_the_discipline_is_matched_without_regard_to_case():
    """A rate card is typed on one screen and a work item's discipline on
    another. `_rate_map` lowercases its keys; this is the other half."""
    out = _labour_cost([task("Firmware", 1), task("FIRMWARE", 1)], GBP)
    assert out["totals"] == [{"currency": "GBP", "amount": 1400.0}]


def test_half_a_day_stays_half_a_day():
    """The input used to be a calendar span, which is always a whole day or more,
    and the arithmetic truncated. A recorded effort feeds this now: `int()` would
    turn 2.5 into 2, and a minimum of one would bill a fifteen-minute errand as a
    full day."""
    out = _labour_cost([task("firmware", 2.5)], GBP)
    assert out["totals"] == [{"currency": "GBP", "amount": 1750.0}]


def test_a_quarter_of_a_day_is_not_rounded_up_to_one():
    out = _labour_cost([task("firmware", 0.25)], GBP)
    assert out["totals"] == [{"currency": "GBP", "amount": 175.0}]


def test_negative_days_cannot_credit_the_project():
    """Nothing writes one, and a stray minus sign in a payload would otherwise
    reduce what the project is reported to have cost."""
    out = _labour_cost([task("firmware", -5), task("firmware", 1)], GBP)
    assert out["totals"] == [{"currency": "GBP", "amount": 700.0}]


# --- the two policies --------------------------------------------------------


def test_two_currencies_are_reported_apart_and_never_summed():
    out = _labour_cost([task("firmware", 1), task("hardware", 1)], TWO)
    assert out["totals"] == [
        {"currency": "EUR", "amount": 400.0},
        {"currency": "GBP", "amount": 700.0},
    ]


def test_a_discipline_with_no_rate_keeps_its_days_and_is_named():
    """A panel that simply showed a smaller number would read as an estimate that
    shrank. This says which discipline has no rate, which is a question somebody
    can answer."""
    out = _labour_cost([task("firmware", 1), task("acoustics", 4)], GBP)
    assert out["unrated_roles"] == ["acoustics"]
    unrated = next(r for r in out["by_role"] if r["role"] == "acoustics")
    assert (unrated["days"], unrated["cost"], unrated["rated"]) == (4, 0.0, False)
    assert out["totals"] == [{"currency": "GBP", "amount": 700.0}]


def test_an_item_with_no_discipline_is_counted_as_unassigned():
    """Skipping it made a project whose items carry no role report NOTHING — no
    days, no cost, an empty panel that reads as a broken feature rather than as a
    question nobody has answered."""
    out = _labour_cost([task(None, 3), task("", 2)], GBP)
    assert [r["role"] for r in out["by_role"]] == ["unassigned"]
    assert out["by_role"][0]["days"] == 5


def test_the_rows_are_ordered_by_what_they_cost():
    out = _labour_cost([task("hardware", 1), task("firmware", 1)], TWO)
    assert [r["role"] for r in out["by_role"]] == ["firmware", "hardware"]


def test_an_empty_plan_is_empty_rather_than_zero():
    out = _labour_cost([], GBP)
    assert out == {"by_role": [], "totals": [], "unrated_roles": []}
