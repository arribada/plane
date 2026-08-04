# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The rule that keeps the folder tree a tree.

Folders nest, and a folder moved inside its own subtree stops being reachable
from the root: it vanishes from the sidebar, and any renderer that walks parents
to compute depth spins forever. The check is cheap and the failure is total, so
it is worth pinning.

No database: the walk takes a plain {id: parent_id} mapping, which is also how
the view calls it — one query for the workspace rather than one per level.
"""

from plane.arribada.views import _folder_reaches


# A ── B ── C
# D (unrelated root)
TREE = {"A": None, "B": "A", "C": "B", "D": None}


def test_a_folder_reaches_itself():
    """The self-move — dropping a folder onto its own header."""
    assert _folder_reaches("A", "A", TREE) is True


def test_a_child_reaches_its_parent():
    assert _folder_reaches("B", "A", TREE) is True


def test_a_grandchild_reaches_its_grandparent():
    """The one a single-level check would miss: moving A under C."""
    assert _folder_reaches("C", "A", TREE) is True


def test_a_parent_does_not_reach_its_child():
    """Moving C under A is legal — it is already there, and re-parenting down the
    tree is the ordinary case."""
    assert _folder_reaches("A", "C", TREE) is False


def test_unrelated_roots_do_not_reach_each_other():
    assert _folder_reaches("D", "A", TREE) is False
    assert _folder_reaches("A", "D", TREE) is False


def test_a_missing_parent_ends_the_walk():
    """A folder whose parent was deleted out from under it must not raise."""
    assert _folder_reaches("orphan", "A", {"orphan": "gone"}) is False


def test_an_existing_cycle_terminates():
    """Nothing should be able to produce this now, but a direct DB edit could —
    and the walk has to return rather than hang the request."""
    cyclic = {"X": "Y", "Y": "X"}
    assert _folder_reaches("X", "Z", cyclic) is False
