# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Where the GitHub router files work, and where it refuses to.

Two refusals, both about a project that is no longer what it was when the
router last looked:

  A repo whose OWNER CHANGED. An item the router filed under project A while A
  claimed the repo is not moved to B when B takes the claim over. `Issue.save`
  numbers an item on insert only and nothing makes (project, sequence_id)
  unique, so a move in place made a second "B-17" beside B's real one, and
  every lookup by reference then picked one of the two at random. The item
  stays, the run names it, a person moves it.

  A repo claimed only by a RETIRED project. A wiki doc row survives Plane's soft
  delete, so a deleted or archived project went on voting for its repos: they
  were fetched every half hour, and their issues filled the triage queue and
  the daily digest with work nobody could file anywhere.

Needs a database. GitHub is stubbed at `_fetch_open_issues`, which is the only
network call a run with nothing to close makes.
"""

import pytest
from django.utils import timezone

from plane.app.permissions import ROLE
from plane.arribada import github_sync_task as sync
from plane.arribada.models import GithubIssue, ProjectWikiDoc
from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember

REPO = "arribada/linkit-v4-core"
REPO_URL = f"https://github.com/{REPO}"


def _project(workspace, owner, name, identifier, **extra):
    project = Project.objects.create(
        name=name, workspace=workspace, created_by=owner, identifier=identifier, **extra
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value
    )
    State.objects.create(
        name="Backlog", project=project, workspace=workspace, group="backlog", default=True, sequence=1
    )
    State.objects.create(
        name="Done", project=project, workspace=workspace, group="completed", sequence=2
    )
    return project


@pytest.fixture
def world(db):
    owner = User.objects.create(email="gh-owner@arribada.test", username="gh-owner")
    workspace = Workspace.objects.create(name="GitHub routing", owner=owner, slug="gh-routing")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)
    return {
        "owner": owner,
        "workspace": workspace,
        "a": _project(workspace, owner, "Alpha", "ALPHA"),
        "b": _project(workspace, owner, "Bravo", "BRAVO"),
    }


def _gh(number, gid, **extra):
    body = {
        "id": gid,
        "number": number,
        "title": f"Issue {number}",
        "body": "",
        "html_url": f"{REPO_URL}/issues/{number}",
        "state": "open",
        "labels": [],
        "assignees": [],
        "milestone": None,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z",
        "closed_at": None,
    }
    body.update(extra)
    return body


def _claim(project, urls):
    ProjectWikiDoc.objects.update_or_create(project=project, defaults={"github_repo_urls": urls})


def _run(monkeypatch, issues):
    """One sync, with GitHub answering `issues` — whole — for every repo asked."""
    monkeypatch.setenv("GITHUB_PAT", "ghp_test")
    monkeypatch.delenv("GITHUB_SYNC_REPOS", raising=False)
    monkeypatch.setattr(
        sync, "_fetch_open_issues", lambda pat, repo, max_pages=5: (list(issues), True)
    )
    return sync._github_plane_sync()


# --- the owner moved -----------------------------------------------------------


def test_a_claim_that_moves_leaves_the_filed_item_where_it_is(world, monkeypatch):
    _claim(world["a"], [REPO_URL])
    first = _run(monkeypatch, [_gh(7, 1007)])
    assert first["created"] == 1, first
    item = Issue.objects.get(external_source="github", external_id="1007")
    assert item.project_id == world["a"].id
    number = item.sequence_id

    # Bravo already has an item carrying the same number — exactly the row a
    # move in place would have put a second "BRAVO-n" beside.
    rival = Issue.objects.create(
        name="Bravo's own", project=world["b"], workspace=world["workspace"], created_by=world["owner"]
    )
    assert rival.sequence_id == number

    _claim(world["a"], [])
    _claim(world["b"], [REPO_URL])
    second = _run(monkeypatch, [_gh(7, 1007)])

    item.refresh_from_db()
    assert item.project_id == world["a"].id, "the router relocated the item to the new owner"
    assert item.sequence_id == number
    assert Issue.objects.filter(project=world["b"], sequence_id=number).count() == 1, (
        f"two work items are now BRAVO-{number}"
    )
    assert second["created"] == 0
    assert second["relocation_refused"] == [
        {"issue": f"{REPO}#7", "item": f"ALPHA-{number}", "claimed_by": "BRAVO"}
    ]
    # The record still says where the issue lives; the queue must not offer it again.
    assert GithubIssue.objects.get(repo=REPO, number=7).filed_issue_id == item.id


def test_an_item_whose_owner_moved_is_still_kept_current(world, monkeypatch):
    """Not relocating is not abandoning: the title and the link stay the router's."""
    _claim(world["a"], [REPO_URL])
    _run(monkeypatch, [_gh(7, 1007)])
    _claim(world["a"], [])
    _claim(world["b"], [REPO_URL])

    result = _run(monkeypatch, [_gh(7, 1007, title="Issue 7, renamed upstream")])

    item = Issue.objects.get(external_source="github", external_id="1007")
    assert item.name == "Issue 7, renamed upstream"
    assert item.project_id == world["a"].id
    assert result["updated"] == 1
    assert len(result["relocation_refused"]) == 1


def test_a_run_with_nothing_to_relocate_says_so(world, monkeypatch):
    _claim(world["a"], [REPO_URL])
    assert _run(monkeypatch, [_gh(7, 1007)])["relocation_refused"] == []
    assert _run(monkeypatch, [_gh(7, 1007)])["relocation_refused"] == []


# --- retired projects do not vote -------------------------------------------------


def test_a_repo_claimed_only_by_a_retired_project_is_not_synced(world, monkeypatch):
    monkeypatch.delenv("GITHUB_SYNC_REPOS", raising=False)
    _claim(world["a"], ["https://github.com/arribada/live-repo"])

    archived = _project(
        world["workspace"], world["owner"], "Archived", "ARCH", archived_at=timezone.now()
    )
    _claim(archived, ["https://github.com/arribada/archived-repo"])

    deleted = _project(world["workspace"], world["owner"], "Deleted", "DEL")
    _claim(deleted, ["https://github.com/arribada/deleted-repo"])
    Project.objects.filter(id=deleted.id).update(deleted_at=timezone.now())

    assert sync._repos_to_sync() == {"arribada/live-repo"}


def test_the_explicit_list_still_adds_to_the_live_claims(world, monkeypatch):
    monkeypatch.setenv("GITHUB_SYNC_REPOS", "Arribada/Extra.git, arribada/live-repo")
    _claim(world["a"], ["https://github.com/arribada/live-repo"])
    assert sync._repos_to_sync() == {"arribada/live-repo", "arribada/extra"}


def test_a_retired_projects_repo_is_not_fetched_by_the_run(world, monkeypatch):
    """The list is what the run fetches, so a retired repo's issues never reach the queue."""
    archived = _project(
        world["workspace"], world["owner"], "Archived", "ARCH", archived_at=timezone.now()
    )
    _claim(archived, [REPO_URL])

    fetched = []

    def fake(pat, repo, max_pages=5):
        fetched.append(repo)
        return [_gh(1, 1001)], True

    monkeypatch.setenv("GITHUB_PAT", "ghp_test")
    monkeypatch.delenv("GITHUB_SYNC_REPOS", raising=False)
    monkeypatch.setattr(sync, "_fetch_open_issues", fake)
    result = sync._github_plane_sync()

    assert fetched == []
    assert result.get("skipped"), result
    assert not GithubIssue.objects.filter(repo=REPO).exists()
