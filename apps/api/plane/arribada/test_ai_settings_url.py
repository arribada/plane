# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The planning assistant's base URL must be somewhere the key can be sent.

`WorkspaceAiSettingsEndpoint.put` accepted any string as `base_url`, and `ai.py`
then POSTed the workspace's private key to it in a header. A plain http:// URL
hands that key to every hop on the way; a LAN address is somebody else's box.
https:// anywhere; http:// only to the host itself, where a developer runs a
local model and nothing crosses a wire.

Run explicitly: `python -m pytest plane/arribada/test_ai_settings_url.py`
"""

import pytest
from django.urls import reverse

from plane.arribada.models import WorkspaceAiSettings


def _put(world, body):
    return world["clients"]["owner"].put(
        reverse("arribada-ai-settings", kwargs={"slug": world["slug"]}), body, format="json"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url",
    [
        "http://models.example.org/v1",
        "http://10.0.0.7:8000/v1",
        "ftp://models.example.org/v1",
        "models.example.org/v1",
        "http://localhost.example.org/v1",
    ],
)
def test_a_url_the_key_must_not_be_sent_to_is_refused(money_project, url):
    response = _put(money_project, {"provider": "custom", "base_url": url, "api_key": "sk-test"})
    assert response.status_code == 400, response.data
    row = WorkspaceAiSettings.objects.filter(workspace=money_project["workspace"]).first()
    assert row is None or (row.base_url == "" and not row.encrypted_api_key), (
        "a refused base URL was written anyway"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url",
    ["https://models.example.org/v1", "http://localhost:11434/v1", "http://127.0.0.1:8000/v1"],
)
def test_https_anywhere_and_http_only_to_the_host_itself(money_project, url):
    response = _put(money_project, {"provider": "custom", "base_url": url})
    assert response.status_code == 200, response.data
    assert WorkspaceAiSettings.objects.get(workspace=money_project["workspace"]).base_url == url


@pytest.mark.django_db
def test_clearing_the_url_of_a_hosted_provider_is_still_allowed(money_project):
    """Blank means "the provider's default endpoint" for every provider but
    custom, and the rule above must not turn that into a 400."""
    response = _put(money_project, {"provider": "groq", "base_url": ""})
    assert response.status_code == 200, response.data
