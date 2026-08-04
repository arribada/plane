# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What GitHub says, turned into what Plane needs — and when to say nothing.

The interesting half of this is the silence. Every one of these functions can
decline, and declining is usually the right answer: a wrong discipline costs the
wrong rate and never shows up, while a missing one appears on the Overview as a
gap somebody can fix. These tests pin the refusals as hard as the matches.

No database: the mapping is pure, which is why it lives apart from the task.
"""

from plane.arribada.github_enrich import (
    cycle_from_milestone,
    discipline_from_labels,
    member_from_github_assignees,
    priority_from_labels,
)

VOCAB = ["embedded firmware", "hardware engineer", "mechanical", "qa / test", "PCB Production"]


# --- disciplines -------------------------------------------------------------


def test_a_hint_maps_to_the_projects_vocabulary():
    assert discipline_from_labels(["firmware"], VOCAB) == "embedded firmware"


def test_a_prefixed_label_still_maps():
    """Teams label things "area/firmware" and "Firmware :fire:"."""
    assert discipline_from_labels(["area/firmware"], VOCAB) == "embedded firmware"


def test_the_projects_own_wording_wins_over_a_hint():
    """A team that labels issues "PCB Production" means THEIR discipline."""
    assert discipline_from_labels(["PCB Production"], VOCAB) == "PCB Production"


def test_a_hint_the_project_does_not_use_is_dropped():
    """Offering a discipline nobody on this roster holds is worse than silence."""
    assert discipline_from_labels(["data"], VOCAB) is None


def test_no_labels_is_silence():
    assert discipline_from_labels([], VOCAB) is None
    assert discipline_from_labels(["good first issue"], VOCAB) is None


# --- priority ----------------------------------------------------------------


def test_priority_comes_from_a_label():
    assert priority_from_labels(["bug"]) == "high"


def test_the_stronger_signal_wins():
    """An issue carrying both "p0" and "bug" is urgent, not high."""
    assert priority_from_labels(["bug", "p0"]) == "urgent"


def test_no_priority_label_leaves_it_alone():
    assert priority_from_labels(["firmware"]) is None


# --- people ------------------------------------------------------------------

CANDIDATES = [
    ("u-geoffrey", "geoffrey@arribada.org", "geoffrey"),
    ("u-alasdair", "alasdair@arribada.org", "Alasdair Davies"),
]


def test_a_login_matches_the_local_part_of_an_email():
    assert member_from_github_assignees([{"login": "geoffrey"}], CANDIDATES) == "u-geoffrey"


def test_two_assignees_is_a_decision_not_a_match():
    """Putting work on somebody because a fuzzy match fired is how people stop
    trusting their own task list."""
    assert member_from_github_assignees(
        [{"login": "geoffrey"}, {"login": "alasdair"}], CANDIDATES
    ) is None


def test_an_unknown_login_is_silence():
    assert member_from_github_assignees([{"login": "octocat"}], CANDIDATES) is None


def test_an_ambiguous_login_is_silence():
    """Two accounts answering to the same name is not a match."""
    twins = [("u-a", "sam@x.org", "sam"), ("u-b", "other@x.org", "sam")]
    assert member_from_github_assignees([{"login": "sam"}], twins) is None


def test_no_assignee_is_silence():
    assert member_from_github_assignees([], CANDIDATES) is None


# --- sprints -----------------------------------------------------------------

CYCLES = [("c-1", "V2 hardware"), ("c-2", "Sprint V2")]


def test_a_milestone_matches_a_sprint_by_name():
    assert cycle_from_milestone("Sprint V2", CYCLES) == "c-2"


def test_matching_ignores_case_and_punctuation():
    assert cycle_from_milestone("sprint-v2", CYCLES) == "c-2"


def test_a_partial_name_does_not_match():
    """"v2" landing work in "V2 hardware" is the kind of guess that is right
    often enough to be trusted and wrong often enough to hurt."""
    assert cycle_from_milestone("v2", CYCLES) is None


def test_no_milestone_is_silence():
    assert cycle_from_milestone("", CYCLES) is None
    assert cycle_from_milestone(None, CYCLES) is None
