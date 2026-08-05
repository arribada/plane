# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""When the money runs out, and the arithmetic that used to 500 the page.

`exhausted_on` divides what is left by the current rate and adds that many
months to today. `rate` is the mean of the last three months WITH spend, not of
the last three calendar months — so one small line after a quiet stretch IS the
rate. A EUR 1 test expense against EUR 100,000 remaining is 100,000 months of
runway, which is the year 10,359, which `datetime.date` refuses.

That refusal did not produce a missing date. It raised out of a helper nothing
catches, into the endpoint, and 500ed the entire budget payload — the allocation,
the labour, the ledger and the funder report all ride in the same response. A
number this arbitrary must not be able to take a page down.

No database: `_spend_rhythm` is arithmetic over two dicts.

Run explicitly: `python -m pytest plane/arribada/test_spend_rhythm.py`
"""

from datetime import date

from plane.arribada.views import _spend_rhythm


def rhythm(months, allocated=None, committed=0.0, target=None):
    return _spend_rhythm(months, {}, allocated, committed, target, "EUR", [])


# --- the runway that ran off the end of the calendar --------------------------


def test_a_tiny_rate_against_a_real_budget_does_not_raise():
    """The 500. One EUR 1 line is a EUR 1 rate, and EUR 100,000 of budget is then
    100,000 months away — the year 10,359."""
    out = rhythm({"2026-01": 1.0}, allocated=100_000.0, committed=1.0)
    assert out["exhausted_on"] is None
    # Everything else still answers, which is the point: the reading that cannot
    # be given is one field, not the whole page.
    assert out["rate"] == 1.0
    assert out["months"] == [{"month": "2026-01", "amount": 1.0, "labour": 0.0, "expense": 1.0}]


def test_the_smallest_rate_that_survives_rounding_still_does_not_raise():
    """`rate` is rounded to two places, so 0.01 is the floor above zero — and the
    worst case, about 1e12 months."""
    out = rhythm({"2026-01": 0.01}, allocated=9_999_999_999.99, committed=0.01)
    assert out["exhausted_on"] is None


def test_an_ordinary_rate_still_gets_a_date():
    """The guard must not swallow the reading it exists to protect."""
    out = rhythm({"2026-01": 5000.0}, allocated=20_000.0, committed=5000.0)
    # 15,000 left at 5,000 a month is three months.
    assert out["exhausted_on"] is not None
    assert date.fromisoformat(out["exhausted_on"]).year <= date.today().year + 1


def test_no_allocation_means_no_date_rather_than_a_guess():
    assert rhythm({"2026-01": 5000.0})["exhausted_on"] is None


def test_a_budget_already_overspent_has_no_runway_to_report():
    assert rhythm({"2026-01": 5000.0}, allocated=1000.0, committed=5000.0)["exhausted_on"] is None


def test_no_spend_at_all_means_no_rate_and_no_date():
    out = rhythm({}, allocated=20_000.0)
    assert (out["rate"], out["exhausted_on"], out["months"]) == (None, None, [])


# --- what the rate is the mean OF --------------------------------------------


def test_the_rate_is_the_last_three_months_with_spend_not_the_last_three_months():
    """A project that bought nothing in August is not a project whose rate fell by
    a third; it is a project that bought nothing in August."""
    out = rhythm({"2026-01": 300.0, "2026-02": 0.0, "2026-05": 600.0, "2026-06": 900.0})
    assert out["rate"] == 600.0
    # The empty months are still on the chart — a gap is a fact about the project.
    assert [m["month"] for m in out["months"]] == [
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]
