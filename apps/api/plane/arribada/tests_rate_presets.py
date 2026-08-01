# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Pure-function tests for the rate presets and the EUR/GBP conversion — no
# Django/DB needed.
# Run: python -m pytest plane/arribada/tests_rate_presets.py

import ast
import pathlib

from plane.arribada.rate_presets import (
    DISPLAY_CURRENCIES,
    RATE_PRESETS,
    convert,
    preset_payload,
)

_MODELS = pathlib.Path(__file__).with_name("models.py")


def _project_roles():
    """PROJECT_ROLES read from the source rather than imported.

    Importing models.py needs Django settings configured, which is the whole
    reason these tests are fast. Reading the literal keeps the guard below honest:
    add a role to the catalogue and forget the presets, and this fails.
    """
    tree = ast.parse(_MODELS.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "PROJECT_ROLES":
            return ast.literal_eval(node.value)
    raise AssertionError("PROJECT_ROLES not found in models.py")


def test_every_catalogue_role_has_a_figure_in_every_market():
    roles = _project_roles()
    assert roles, "the catalogue is empty"
    for preset in RATE_PRESETS:
        missing = [value for value, _label in roles if value.strip().lower() not in preset["rates"]]
        assert not missing, f"{preset['country']} has no rate for {missing}"


def test_role_keys_are_lowercased():
    # WorkspaceRoleRate lowercases on write and _rate_map lowercases on read, so a
    # preset keyed on the catalogue's own casing would silently miss "QA / test"
    # and "data / science" — the two roles that carry capitals.
    for preset in RATE_PRESETS:
        for role in preset["rates"]:
            assert role == role.lower(), f"{preset['country']}: {role!r} is not lowercased"


def test_the_two_markets_are_not_one_table_run_through_an_exchange_rate():
    fr = next(p for p in RATE_PRESETS if p["country"] == "FR")["rates"]
    uk = next(p for p in RATE_PRESETS if p["country"] == "UK")["rates"]
    ratios = [uk[role] / fr[role] for role in fr if role in uk]
    # A single FX factor would make every ratio identical. Real markets differ in
    # shape: the UK spread between a field technician and a firmware engineer is
    # much wider than the French one.
    assert max(ratios) - min(ratios) > 0.15, "the UK table looks like the FR table times a constant"


def test_presets_carry_their_provenance():
    for preset in preset_payload():
        assert preset["source"].strip(), "a rate nobody can attribute is a rate nobody will defend"
        assert preset["captured_on"], "a rate without a date cannot be told apart from a stale one"
        assert preset["currency"] in DISPLAY_CURRENCIES
        assert 0.5 <= preset["hours_per_day"] <= 24


def test_conversion_both_ways_and_round_trip():
    assert convert(100, "EUR", "GBP", 0.85) == 85
    assert round(convert(100, "GBP", "EUR", 0.85), 2) == 117.65
    assert convert(100, "EUR", "EUR", 0.85) == 100
    assert round(convert(convert(100, "EUR", "GBP", 0.85), "GBP", "EUR", 0.85), 6) == 100


def test_a_third_currency_is_never_guessed_at():
    # The whole point of naming the unconvertible rather than converting it: a
    # dollar figure has no honest position in a sterling total.
    assert convert(100, "USD", "GBP", 0.85) is None
    assert convert(100, "EUR", "USD", 0.85) is None


def test_a_missing_or_impossible_rate_returns_nothing_rather_than_zero():
    assert convert(100, "EUR", "GBP", 0) is None
    assert convert(100, "EUR", "GBP", None) is None
    assert convert(100, "EUR", "GBP", "not a number") is None
    assert convert(100, "EUR", "", 0.85) is None
