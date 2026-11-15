# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A rate of zero is not a price; it is the absence of one.

`WorkspaceRoleRatesEndpoint.put` stored whatever number it was sent, so a row
sent with `hourly_rate: 0` — the card's way of saying "take this discipline off
the card" — became a row that costed every hour of that discipline at nothing
while its existence said a rate had been set. A zero (or negative) rate now
deletes the row, and the response names it in `removed`.

The same loop ran its numbers through `max(0, min(cap, float(...)))`, which
turns "nan" into the cap: NaN compares False to everything, so `min` keeps its
first argument and `max` keeps the ceiling. Those rows are skipped and named in
`rejected`, never stored.

Run explicitly: `python -m pytest plane/arribada/test_role_rates_put.py`
"""

import pytest
from django.urls import reverse

from plane.arribada.models import WorkspaceRoleRate


def _url(world):
    return reverse("arribada-workspace-role-rates", kwargs={"slug": world["slug"]})


def _put(world, rows):
    response = world["clients"]["owner"].put(_url(world), {"rates": rows}, format="json")
    assert response.status_code == 200, response.data
    return response.data


def _roles(world):
    return [r.role for r in WorkspaceRoleRate.objects.filter(workspace=world["workspace"])]


@pytest.mark.django_db
def test_a_zero_rate_deletes_the_row_and_says_so(money_project):
    WorkspaceRoleRate.objects.create(
        workspace=money_project["workspace"], role="firmware", hourly_rate=100, hours_per_day=7, currency="GBP"
    )
    data = _put(money_project, [{"role": "firmware", "hourly_rate": 0, "hours_per_day": 7, "currency": "GBP"}])
    assert data["removed"] == ["firmware"]
    assert data["rates"] == []
    assert _roles(money_project) == [], (
        "a zero rate was stored as a row that costs the discipline at nothing"
    )


@pytest.mark.django_db
def test_a_negative_rate_is_the_same_as_zero(money_project):
    WorkspaceRoleRate.objects.create(workspace=money_project["workspace"], role="firmware", hourly_rate=100)
    data = _put(money_project, [{"role": "firmware", "hourly_rate": -5}])
    assert data["removed"] == ["firmware"]
    assert _roles(money_project) == []


@pytest.mark.django_db
def test_a_positive_rate_is_stored_and_nothing_is_removed(money_project):
    data = _put(money_project, [{"role": "Firmware", "hourly_rate": 95.5, "hours_per_day": 7.5, "currency": "gbp"}])
    assert data["removed"] == []
    assert data["rejected"] == []
    assert data["rates"] == [{"role": "firmware", "hourly_rate": 95.5, "hours_per_day": 7.5, "currency": "GBP"}]
    assert _roles(money_project) == ["firmware"]


@pytest.mark.django_db
def test_removing_one_role_leaves_the_others_alone(money_project):
    for role in ("firmware", "antennas"):
        WorkspaceRoleRate.objects.create(workspace=money_project["workspace"], role=role, hourly_rate=100)
    data = _put(money_project, [{"role": "antennas", "hourly_rate": 0}, {"role": "firmware", "hourly_rate": 120}])
    assert data["removed"] == ["antennas"]
    assert _roles(money_project) == ["firmware"]
    assert float(WorkspaceRoleRate.objects.get(workspace=money_project["workspace"], role="firmware").hourly_rate) == 120.0


@pytest.mark.django_db
def test_a_nan_rate_is_neither_stored_nor_the_cap(money_project):
    """`max(0, min(100000, float("nan")))` is 100000: an hour of firmware at a
    hundred thousand, from a field somebody typed "nan" into."""
    data = _put(
        money_project,
        [{"role": "firmware", "hourly_rate": "nan"}, {"role": "antennas", "hourly_rate": "inf"}],
    )
    assert sorted(data["rejected"]) == ["antennas", "firmware"]
    assert data["rates"] == []
    assert _roles(money_project) == []
