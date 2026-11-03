# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The project link with the wiki's project template.

What can go wrong here is quiet: a project created with no states (the public
API's failure mode), a Plane project re-pointed from one wiki page to another
without anyone noticing, or a refusal that still wrote the row. So every
refusal below also checks that nothing was written, and every success counts
the rows it should have made.

Run explicitly: `python -m pytest plane/arribada/test_wiki_projects.py`
"""

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from plane.arribada import wiki_projects
from plane.arribada.models import ProjectWikiDoc
from plane.db.models import Project, ProjectMember, State
from plane.db.models.state import DEFAULT_STATES

SECRET = "wiki-link-test-secret"
NODE = "01m6gsp7fpazyg7xd513k823w1pg"
OTHER_NODE = "01m6gsp7fpazyg7xd513k823w9pg"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setenv("WIKI_PROJECT_LINK_SECRET", SECRET)
    return SECRET


@pytest.fixture
def wiki():
    """The wiki server: no session, only the shared secret."""
    client = APIClient()
    client.credentials(HTTP_X_WIKI_SECRET=SECRET)
    return client


def _url(money_project):
    return reverse("arribada-wiki-projects", kwargs={"slug": money_project["slug"]})


# --- the secret ---------------------------------------------------------------


def test_nothing_answers_until_the_secret_is_configured(money_project, wiki, monkeypatch):
    monkeypatch.delenv("WIKI_PROJECT_LINK_SECRET", raising=False)
    assert wiki.get(_url(money_project)).status_code == 503


def test_a_wrong_secret_is_refused_and_writes_nothing(money_project, secret):
    stranger = APIClient()
    stranger.credentials(HTTP_X_WIKI_SECRET="not-it")
    assert stranger.get(_url(money_project)).status_code == 401
    answer = stranger.post(
        _url(money_project),
        {"mode": "link", "identifier": "TAG", "name": "Tag", "wiki_node_id": NODE},
        format="json",
    )
    assert answer.status_code == 401
    assert not ProjectWikiDoc.objects.filter(project=money_project["project"]).exists()


def test_a_project_member_session_is_not_the_secret(money_project, secret):
    """The endpoint has no session auth at all: a logged-in member is refused."""
    member = money_project["clients"]["member"]
    assert member.get(_url(money_project)).status_code == 401


# --- listing ------------------------------------------------------------------


def test_the_list_carries_identifiers_links_and_archived_projects(money_project, secret, wiki):
    archived = Project.objects.create(
        name="Old",
        identifier="OLD",
        workspace=money_project["workspace"],
        archived_at=timezone.now(),
    )
    ProjectWikiDoc.objects.create(project=money_project["project"], doc_id=NODE)

    answer = wiki.get(_url(money_project))
    assert answer.status_code == 200
    rows = {row["identifier"]: row for row in answer.json()["projects"]}
    assert set(rows) == {"TAG", "OLD"}
    assert rows["TAG"]["wiki_node_id"] == NODE
    assert rows["TAG"]["archived"] is False
    assert rows["OLD"]["wiki_node_id"] is None
    assert rows["OLD"]["archived"] is True
    assert rows["OLD"]["project_id"] == str(archived.id)


# --- link ---------------------------------------------------------------------


def test_linking_points_a_free_project_at_the_wiki_and_keeps_its_other_links(money_project, secret, wiki):
    ProjectWikiDoc.objects.create(project=money_project["project"], chat_url="https://chat.arribada.org/x")
    answer = wiki.post(
        _url(money_project),
        {"mode": "link", "identifier": "TAG", "name": "Tag", "wiki_node_id": NODE, "wiki_title": "Tag — Overview"},
        format="json",
    )
    assert answer.status_code == 200, answer.content
    doc = ProjectWikiDoc.objects.get(project=money_project["project"])
    assert doc.doc_id == NODE
    assert doc.chat_url == "https://chat.arribada.org/x"
    assert answer.json()["project"]["wiki_node_id"] == NODE


def test_a_project_linked_to_another_page_is_not_repointed(money_project, secret, wiki):
    ProjectWikiDoc.objects.create(project=money_project["project"], doc_id=OTHER_NODE)
    answer = wiki.post(
        _url(money_project),
        {"mode": "link", "identifier": "TAG", "name": "Tag", "wiki_node_id": NODE},
        format="json",
    )
    assert answer.status_code == 409
    assert ProjectWikiDoc.objects.get(project=money_project["project"]).doc_id == OTHER_NODE


def test_linking_an_identifier_plane_does_not_have_is_a_404(money_project, secret, wiki):
    answer = wiki.post(
        _url(money_project),
        {"mode": "link", "identifier": "NOPE", "name": "Nope", "wiki_node_id": NODE},
        format="json",
    )
    assert answer.status_code == 404


# --- create -------------------------------------------------------------------


def test_create_makes_a_complete_project_owned_by_the_person_who_asked(money_project, secret, wiki):
    member = money_project["users"]["member"]
    answer = wiki.post(
        _url(money_project),
        {
            "mode": "create",
            "identifier": "STUG",
            "name": "Sea Turtle Tag GPS",
            "wiki_node_id": NODE,
            "wiki_title": "Sea Turtle Tag GPS — Overview",
            "actor_email": member.email.upper(),
        },
        format="json",
    )
    assert answer.status_code == 201, answer.content

    project = Project.objects.get(workspace=money_project["workspace"], identifier="STUG")
    assert project.name == "Sea Turtle Tag GPS"
    assert project.created_by_id == member.id
    assert project.project_lead_id == member.id
    assert project.external_source == "arribada-wiki"
    assert project.external_id == NODE
    assert project.cycle_view and project.module_view and project.issue_views_view and project.page_view
    # `State.objects` hides the triage state; count every state that was made.
    assert State.all_state_objects.filter(project=project).count() == len(DEFAULT_STATES) == 6
    assert State.all_state_objects.filter(project=project, default=True).count() == 1
    assert ProjectMember.objects.get(project=project, member=member).role == 20
    assert ProjectWikiDoc.objects.get(project=project).doc_id == NODE
    assert answer.json()["project"]["identifier"] == "STUG"


def test_create_refuses_an_identifier_plane_already_has(money_project, secret, wiki):
    before = Project.objects.count()
    answer = wiki.post(
        _url(money_project),
        {
            "mode": "create",
            "identifier": "TAG",
            "name": "Another tag",
            "wiki_node_id": NODE,
            "actor_email": money_project["users"]["member"].email,
        },
        format="json",
    )
    assert answer.status_code == 409
    assert Project.objects.count() == before


def test_create_needs_the_asker_to_be_a_plane_member(money_project, secret, wiki):
    before = Project.objects.count()
    answer = wiki.post(
        _url(money_project),
        {
            "mode": "create",
            "identifier": "STUG",
            "name": "Sea Turtle Tag GPS",
            "wiki_node_id": NODE,
            "actor_email": "nobody@arribada.test",
        },
        format="json",
    )
    assert answer.status_code == 403
    assert Project.objects.count() == before


@pytest.mark.parametrize("identifier", ["STU-T", "360", "A", "ABCDEFGHIJK"])
def test_create_refuses_a_code_the_wiki_cannot_hold(money_project, secret, wiki, identifier):
    before = Project.objects.count()
    answer = wiki.post(
        _url(money_project),
        {
            "mode": "create",
            "identifier": identifier,
            "name": "X",
            "wiki_node_id": NODE,
            "actor_email": money_project["users"]["member"].email,
        },
        format="json",
    )
    assert answer.status_code == 400
    assert Project.objects.count() == before


# --- Plane asking the wiki ------------------------------------------------------


@pytest.fixture
def create_url(money_project):
    return reverse(
        "arribada-project-wiki-project",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )


@pytest.fixture
def fake_wiki(monkeypatch):
    calls = []

    def call(method, path, body=None):
        calls.append((method, path, body))
        if path == "/parents":
            return [{"id": "01ky60x96q2pdcet4xe2k4exqhpg", "spaceId": "s", "name": "Mission Fisheries", "depth": 1, "path": "Mission Fisheries"}]
        return {"root_id": OTHER_NODE, "overview_id": NODE, "url": f"https://docs.arribada.org/ws/{NODE}"}

    monkeypatch.setattr(wiki_projects, "_wiki_call", call)
    return calls


def test_a_member_creates_the_wiki_project_and_the_link_is_stored(money_project, create_url, fake_wiki):
    member = money_project["clients"]["member"]
    answer = member.post(create_url, {"parent_id": "01ky60x96q2pdcet4xe2k4exqhpg"}, format="json")
    assert answer.status_code == 201, answer.content
    assert ProjectWikiDoc.objects.get(project=money_project["project"]).doc_id == NODE

    method, path, body = fake_wiki[0]
    assert (method, path) == ("POST", "/projects")
    assert body["code"] == "TAG"
    assert body["parent_id"] == "01ky60x96q2pdcet4xe2k4exqhpg"
    assert body["actor_email"] == money_project["users"]["member"].email
    assert body["plane_project"]["project_id"] == money_project["project_id"]


def test_a_project_that_already_has_its_wiki_page_is_not_given_a_second(money_project, create_url, fake_wiki):
    ProjectWikiDoc.objects.create(project=money_project["project"], doc_id=OTHER_NODE)
    member = money_project["clients"]["member"]
    answer = member.post(create_url, {"parent_id": "01ky60x96q2pdcet4xe2k4exqhpg"}, format="json")
    assert answer.status_code == 409
    assert fake_wiki == []
    assert ProjectWikiDoc.objects.get(project=money_project["project"]).doc_id == OTHER_NODE


def test_someone_outside_the_project_cannot_create_its_wiki_pages(money_project, create_url, fake_wiki):
    from plane.db.models import User, WorkspaceMember

    outsider = User.objects.create(email="out@arribada.test", username="mw-out")
    WorkspaceMember.objects.create(workspace=money_project["workspace"], member=outsider, role=15)
    client = APIClient()
    client.force_authenticate(user=outsider)
    answer = client.post(create_url, {"parent_id": "01ky60x96q2pdcet4xe2k4exqhpg"}, format="json")
    assert answer.status_code == 403
    assert fake_wiki == []
    assert not ProjectWikiDoc.objects.filter(project=money_project["project"]).exists()


def test_a_project_whose_identifier_has_digits_is_refused_before_the_wiki_is_asked(money_project, create_url, fake_wiki):
    Project.objects.filter(pk=money_project["project"].pk).update(identifier="T360")
    member = money_project["clients"]["member"]
    answer = member.post(create_url, {"parent_id": "01ky60x96q2pdcet4xe2k4exqhpg"}, format="json")
    assert answer.status_code == 400
    assert fake_wiki == []


def test_the_wiki_missions_are_listed_for_a_member(money_project, fake_wiki):
    url = reverse(
        "arribada-project-wiki-project-parents",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )
    answer = money_project["clients"]["member"].get(url)
    assert answer.status_code == 200
    assert answer.json()["parents"][0]["name"] == "Mission Fisheries"


# --- throttling ---------------------------------------------------------------

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
def test_the_wiki_is_not_held_to_the_anonymous_rate(money_project, secret, wiki):
    """Aligning every project lists Plane's projects once per project.

    The anonymous rate is 30 a minute; with a cache that counts (the test run
    has no Redis, so this one is in memory) the 31st list used to be a 429.
    """
    cache.clear()
    codes = [wiki.get(_url(money_project)).status_code for _ in range(40)]
    assert codes == [200] * 40


@override_settings(CACHES=LOCMEM)
def test_a_caller_without_the_secret_is_still_throttled(money_project, secret):
    cache.clear()
    stranger = APIClient()
    stranger.credentials(HTTP_X_WIKI_SECRET="not-it")
    codes = [stranger.get(_url(money_project)).status_code for _ in range(35)]
    assert codes[:30] == [401] * 30
    assert 429 in codes[30:]
