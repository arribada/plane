# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# What counts as "this person is on two things at once" — the rule the workload
# timeline paints red. No Django/DB needed.
# Run: python -m pytest plane/arribada/tests_workload_overlap.py

import importlib.util
import pathlib
import re
import sys
import types
from datetime import date, timedelta

import pytest

_HERE = pathlib.Path(__file__).parent


def _load_blueprints():
    """The real blueprints module, loaded by path.

    It is pure (stdlib only), but it lives in `plane.arribada`, importing which drags
    in models.py and therefore Django settings. So it is loaded under a throwaway
    package instead — the code under test is the shipped code, not a copy.
    """
    package = types.ModuleType("_arribada_pure")
    package.__path__ = [str(_HERE)]
    sys.modules.setdefault("_arribada_pure", package)
    spec = importlib.util.spec_from_file_location("_arribada_pure.blueprints", _HERE / "blueprints.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_arribada_pure.blueprints"] = module
    spec.loader.exec_module(module)
    return module


def _load_overlap_helpers():
    """The three pure helpers, sliced out of views.py and exec'd.

    views.py cannot be imported without Django configured, and these functions are
    the definition of a conflict — the thing most worth pinning down. Same trick
    tests_rate_presets.py uses on models.py, and it tests the live source: a change
    to views.py changes what runs here.
    """
    _load_blueprints()
    source = (_HERE / "views.py").read_text(encoding="utf-8")

    def slice_function(name):
        start = source.index(f"\ndef {name}(")
        rest = source[start + 1 :]
        end = re.search(r"\n(?=(def |class |# ---))", rest)
        return rest[: end.start()] if end else rest

    namespace = {
        "__name__": "_arribada_pure.views_shim",
        "__package__": "_arribada_pure",
        "timedelta": timedelta,
        "date": date,
        "WORKLOAD_WINDOW_MAX_DAYS": 1096,
    }
    for name in ("_working_day_test", "_count_working_days", "_overlap_regions"):
        exec(slice_function(name), namespace)  # noqa: S102
    return namespace


_NS = _load_overlap_helpers()
_regions = _NS["_overlap_regions"]
_count = _NS["_count_working_days"]
_test_for = _NS["_working_day_test"]

# 3-7 Aug 2026 is a Mon-Fri; 8-9 Aug is the weekend; 10 Aug is the next Monday.
WORKING = _test_for(frozenset(), [])


def test_plain_overlap_is_reported_with_its_working_days():
    regions = _regions(
        [(date(2026, 8, 3), date(2026, 8, 7), "A"), (date(2026, 8, 5), date(2026, 8, 12), "B")], WORKING
    )
    assert len(regions) == 1
    assert (regions[0]["start"], regions[0]["end"]) == (date(2026, 8, 5), date(2026, 8, 7))
    assert regions[0]["days"] == 3
    assert sorted(regions[0]["issue_ids"]) == ["A", "B"]


@pytest.mark.parametrize(
    ("first", "second"),
    [
        # Friday -> Monday: the classic hand-off, and not a clash.
        ((date(2026, 8, 3), date(2026, 8, 7)), (date(2026, 8, 10), date(2026, 8, 14))),
        # Wednesday -> Thursday: consecutive days share nothing either.
        ((date(2026, 8, 3), date(2026, 8, 5)), (date(2026, 8, 6), date(2026, 8, 7))),
    ],
)
def test_end_to_start_is_not_a_conflict(first, second):
    assert _regions([(*first, "A"), (*second, "B")], WORKING) == []


def test_sharing_one_working_day_is_a_conflict():
    regions = _regions(
        [(date(2026, 8, 3), date(2026, 8, 7), "A"), (date(2026, 8, 7), date(2026, 8, 12), "B")], WORKING
    )
    assert len(regions) == 1
    assert regions[0]["days"] == 1


def test_touching_only_across_a_weekend_is_not_a_conflict():
    # A runs to Sunday, B starts Saturday: they intersect on the calendar and cost
    # nobody an hour. Flagging this is what turns a board solid red.
    assert (
        _regions([(date(2026, 8, 3), date(2026, 8, 9), "A"), (date(2026, 8, 8), date(2026, 8, 14), "B")], WORKING)
        == []
    )


def test_one_clash_straddling_a_weekend_is_reported_once():
    regions = _regions(
        [(date(2026, 8, 6), date(2026, 8, 11), "A"), (date(2026, 8, 7), date(2026, 8, 10), "B")], WORKING
    )
    assert len(regions) == 1
    assert regions[0]["days"] == 2


def test_back_to_back_clashes_between_different_pairs_stay_separate():
    # A+B Mon-Fri, then C+D the following Mon-Wed. Only a weekend separates them, so
    # the person never gets a free day — but they are two different double-bookings.
    #
    # These used to be merged into one region carrying all four ids, which the
    # tooltip reads out as "on 4 things at once". Nobody was ever on more than two.
    # Reporting them separately is both true and more useful: it names which pair
    # collides, and when.
    regions = _regions(
        [
            (date(2026, 8, 3), date(2026, 8, 7), "A"),
            (date(2026, 8, 3), date(2026, 8, 7), "B"),
            (date(2026, 8, 10), date(2026, 8, 12), "C"),
            (date(2026, 8, 10), date(2026, 8, 12), "D"),
        ],
        WORKING,
    )
    assert len(regions) == 2
    assert [r["days"] for r in regions] == [5, 3]
    assert [sorted(r["issue_ids"]) for r in regions] == [["A", "B"], ["C", "D"]]


def test_the_same_clash_across_a_weekend_is_still_one_region():
    # The merge that survives: the SAME pair, live either side of a weekend. One
    # double-booking, reported once, not twice.
    regions = _regions(
        [(date(2026, 8, 3), date(2026, 8, 12), "A"), (date(2026, 8, 3), date(2026, 8, 12), "B")],
        WORKING,
    )
    assert len(regions) == 1
    assert sorted(regions[0]["issue_ids"]) == ["A", "B"]


def test_separate_clashes_stay_separate():
    regions = _regions(
        [
            (date(2026, 8, 3), date(2026, 8, 5), "A"),
            (date(2026, 8, 4), date(2026, 8, 5), "B"),
            (date(2026, 9, 1), date(2026, 9, 4), "C"),
            (date(2026, 9, 3), date(2026, 9, 4), "D"),
        ],
        WORKING,
    )
    assert len(regions) == 2


def test_every_colliding_item_is_named():
    regions = _regions(
        [
            (date(2026, 8, 3), date(2026, 8, 14), "A"),
            (date(2026, 8, 5), date(2026, 8, 6), "B"),
            (date(2026, 8, 5), date(2026, 8, 6), "C"),
        ],
        WORKING,
    )
    assert sorted(regions[0]["issue_ids"]) == ["A", "B", "C"]


def test_one_task_never_conflicts_with_itself():
    assert _regions([(date(2026, 8, 3), date(2026, 8, 30), "A")], WORKING) == []


def test_leave_suppresses_a_clash_that_falls_inside_it():
    on_leave = _test_for(frozenset(), [(date(2026, 8, 3), date(2026, 8, 21))])
    assert (
        _regions([(date(2026, 8, 3), date(2026, 8, 7), "A"), (date(2026, 8, 5), date(2026, 8, 12), "B")], on_leave)
        == []
    )


def test_a_workspace_holiday_shortens_the_clash():
    with_holiday = _test_for(frozenset({date(2026, 8, 6)}), [])
    regions = _regions(
        [(date(2026, 8, 3), date(2026, 8, 7), "A"), (date(2026, 8, 5), date(2026, 8, 12), "B")], with_holiday
    )
    assert regions[0]["days"] == 2


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        (date(2026, 8, 3), date(2026, 8, 7), 5),
        (date(2026, 8, 8), date(2026, 8, 9), 0),
        (date(2026, 8, 9), date(2026, 8, 3), 0),
    ],
)
def test_working_day_counting(start, end, expected):
    assert _count(start, end, WORKING) == expected
