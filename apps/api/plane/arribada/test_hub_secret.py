# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The two server-to-server doors compare their secret in constant time.

`HubProjectsEndpoint.get` and `TeamSyncEndpoint.post` compared `X-Hub-Secret`
with `!=`, which returns at the first differing byte — a timing oracle on the
one credential that opens every project's links and lets the wiki rewrite every
roster. `wiki_projects._secret_given` already did this right with
`hmac.compare_digest`; these two now do the same. The 503 when nothing is
configured stays: an unset secret must never read as "no secret required".

Constant time cannot be observed from a unit test, so the last test pins it at
the source — the one place in this suite where a source grep is the honest
assertion rather than a stand-in for one.

Run explicitly: `python -m pytest plane/arribada/test_hub_secret.py`
"""

import inspect

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

SECRET = "a-256-bit-secret-for-the-test"


def _get(world, **headers):
    return APIClient().get(reverse("arribada-hub-projects", kwargs={"slug": world["slug"]}), **headers)


def _post(world, **headers):
    return APIClient().post(
        reverse("arribada-team-sync", kwargs={"slug": world["slug"]}),
        {"entries": []},
        format="json",
        **headers,
    )


CALLS = [pytest.param(_get, id="hub-projects"), pytest.param(_post, id="team-sync")]


@pytest.mark.django_db
@pytest.mark.parametrize("call", CALLS)
def test_the_wrong_secret_is_refused(money_project, monkeypatch, call):
    monkeypatch.setenv("HUB_LINKS_SECRET", SECRET)
    assert call(money_project, HTTP_X_HUB_SECRET="wrong").status_code == 401
    assert call(money_project).status_code == 401


@pytest.mark.django_db
@pytest.mark.parametrize("call", CALLS)
def test_the_right_secret_is_served(money_project, monkeypatch, call):
    monkeypatch.setenv("HUB_LINKS_SECRET", SECRET)
    assert call(money_project, HTTP_X_HUB_SECRET=SECRET).status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize("call", CALLS)
def test_no_secret_configured_is_a_503_not_an_open_door(money_project, monkeypatch, call):
    monkeypatch.delenv("HUB_LINKS_SECRET", raising=False)
    assert call(money_project, HTTP_X_HUB_SECRET="").status_code == 503


def test_the_comparison_is_constant_time():
    from plane.arribada import views

    for handler in (views.HubProjectsEndpoint.get, views.TeamSyncEndpoint.post):
        source = inspect.getsource(handler)
        assert "hmac.compare_digest" in source, handler
        assert 'request.headers.get("X-Hub-Secret") !=' not in source, handler
