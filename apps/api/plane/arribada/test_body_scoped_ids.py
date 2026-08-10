# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""An id in the request body is scoped by the view, because nothing else can.

`test_project_role_boundary.py` walks the URLconf, so it covers every id that
appears in a URL. `test_project_issue_binding.py` does the same for the work-item
half of a URL. Neither can see an id that arrives in a JSON body — and that is
where the two remaining holes lived:

- `ProjectFoldersEndpoint.post` took `parent_id` and wrote it to the column
  unchecked, so a member of ANY workspace could hang a folder under a folder in
  a workspace they have no seat in. Its two sibling handlers, PATCH and assign,
  both look their folder up with `workspace__slug=slug`; this one did not, and
  the delete handler then promoted children across the boundary it had created.
- `AdoptIssuesEndpoint`, the two GitHub filing endpoints and folder assignment
  all scoped their body-supplied project id with `_visible_projects`, which
  answers yes for a GUEST. Adopting is the sharpest of them: an uncapped list of
  ids, each one copied out of its project and marked completed.

There are two rules and they are different, which is why this file tests both:

  workspace   an id from a body may only name a row in the workspace in the URL
  role        an id from a body that is going to be WRITTEN to must name a
              project the caller could write to if it had been in the URL —
              `_writable_projects`, not `_visible_projects`

THE REGISTRY IS THE POINT. A hand-written list of endpoints is exactly what let
five holes stay open through a green suite, so `test_every_body_id_site_is_named`
below reads the source, finds every handler that pulls one of these ids out of a
body, and fails if it is not in the table. A new endpoint cannot be added
silently; it can only be added along with a decision about it.
"""

import ast
import pathlib
import uuid

import pytest
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.models import ProjectFolder, ProjectFolderItem
from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember

# The body keys that name a row the caller does not otherwise prove they own.
BODY_ID_KEYS = {
    "project_id",
    "target_project_id",
    "parent_id",
    "folder_id",
    "parent_issue_id",
    "checklist_owner_id",
    "target_parent_id",
}

# Every handler that reads one, and the shape of the guard it carries. The value
# is prose because the guards are not all the same rule and pretending they were
# is how `_visible_projects` ended up on a write.
COVERED = {
    "ProjectFoldersEndpoint.post": "parent_id must be a folder in this workspace",
    "ProjectFolderDetailEndpoint.patch": "parent_id must be a folder in this workspace",
    "ProjectFolderAssignEndpoint.put": "project_id via _writable_projects; folder via workspace",
    "AdoptIssuesEndpoint.post": "source and target both via _writable_projects, and capped",
    "GithubInboxEndpoint.post": "project_id via _writable_projects; parent must be in it",
    "WorkspaceGithubTriageQueueEndpoint.post": (
        "each entry's project_id via _writable_projects; checklist_owner_id via "
        "_visible_projects, because it is pointed at rather than written to"
    ),
    "WorkspaceGithubRepoClaimEndpoint.post": "winner and losers both via _writable_projects",
    "TeamSyncEndpoint.post": (
        "shared-secret cron, no user session and therefore no role to ask about; the id is "
        "only ever looked up in a dict already filtered to workspace__slug=slug, so the "
        "workspace rule holds and the role rule does not apply"
    ),
}

VIEWS = pathlib.Path(__file__).with_name("views.py")
METHODS = {"get", "post", "patch", "put", "delete"}


def _body_id_sites():
    """Every `<something>.get("project_id")`-shaped read, by handler.

    Parsed rather than grepped so a key mentioned in a comment or a docstring
    does not count, and so the handler it belongs to is known rather than
    guessed from the nearest `class` line above it.
    """
    tree = ast.parse(VIEWS.read_text(encoding="utf-8"))
    found = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for handler in node.body:
            if not (isinstance(handler, ast.FunctionDef) and handler.name in METHODS):
                continue
            keys = set()
            for call in ast.walk(handler):
                if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)):
                    continue
                if call.func.attr != "get" or not call.args:
                    continue
                first = call.args[0]
                if isinstance(first, ast.Constant) and first.value in BODY_ID_KEYS:
                    keys.add(first.value)
            if keys:
                found[f"{node.name}.{handler.name}"] = sorted(keys)
    return found


SITES = _body_id_sites()


def test_every_body_id_site_is_named():
    """The registry guard. This is the assertion that survives the next author.

    An id taken from a body is invisible to both of the URLconf walks, so the
    only way it gets covered is if somebody notices. Reading the source back and
    demanding a table entry replaces noticing with failing.
    """
    assert SITES, "the AST walk found no body-supplied ids at all — has views.py moved?"
    unnamed = sorted(set(SITES) - set(COVERED))
    assert not unnamed, (
        f"these handlers read an id out of the request body and are not in COVERED: {unnamed}. "
        "Neither URLconf walk can see a body id, so add the handler to the table with the guard "
        "it carries — `_writable_projects` if the id is written to, `_visible_projects` if it is "
        "only read, and a workspace filter either way."
    )
    stale = sorted(set(COVERED) - set(SITES))
    assert not stale, f"COVERED names handlers that no longer read a body id: {stale}"


@pytest.fixture
def two_worlds(db):
    """Two workspaces that share nothing, and a project guest in the first.

    `theirs` exists to be named from `ours` — it is the workspace the caller has
    no seat in at all, which is what the folder handlers were reachable across.
    """

    # No passwords: `force_authenticate` bypasses password checking, and the PBKDF2
    # default is expensive enough to dominate a fixture that builds several users.
    def person(email, username):
        return User.objects.create(email=email, username=username)

    owner = person("bodyid-owner@plane.so", "bodyid-owner")
    ours = Workspace.objects.create(name="Ours", owner=owner, slug="bodyid-ours")
    theirs = Workspace.objects.create(name="Theirs", owner=owner, slug="bodyid-theirs")
    for workspace in (ours, theirs):
        WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    watched = Project.objects.create(
        name="Watched", workspace=ours, created_by=owner, identifier="WTCH"
    )
    worked = Project.objects.create(
        name="Worked", workspace=ours, created_by=owner, identifier="WRKD"
    )
    for project in (watched, worked):
        ProjectMember.objects.create(
            project=project, workspace=ours, member=owner, role=ROLE.ADMIN.value
        )
        State.objects.create(
            name="Done", group="completed", project=project, workspace=ours, sequence=1
        )
    backlog = Issue.objects.create(
        project=watched, workspace=ours, name="Their backlog item", created_by=owner
    )

    # GUEST on the project they watch, MEMBER on the one they work — the ordinary
    # shape of a funder who also does some work here, and the account every one of
    # these endpoints was reachable by.
    guest = person("bodyid-guest@plane.so", "bodyid-guest")
    WorkspaceMember.objects.create(workspace=ours, member=guest, role=ROLE.MEMBER.value)
    ProjectMember.objects.create(
        project=watched, workspace=ours, member=guest, role=ROLE.GUEST.value
    )
    ProjectMember.objects.create(
        project=worked, workspace=ours, member=guest, role=ROLE.MEMBER.value
    )
    guest_client = APIClient()
    guest_client.force_authenticate(user=guest)

    owner_client = APIClient()
    owner_client.force_authenticate(user=owner)

    return {
        "ours": ours,
        "theirs": theirs,
        "watched": watched,
        "worked": worked,
        "backlog": backlog,
        "guest": guest_client,
        "owner": owner_client,
    }


# --- the workspace rule ------------------------------------------------------


def test_a_folder_cannot_be_parented_into_another_workspace(two_worlds):
    """`parent_id` went to the column unchecked.

    The caller here is a full ADMIN of both workspaces, which is the point: this
    is not about sneaking in. `slug` is the scope of the request, and a body must
    not be able to widen it — otherwise "which workspace am I in" stops being a
    property of the URL and every filter written against it becomes a suggestion.
    """
    theirs_folder = ProjectFolder.objects.create(workspace=two_worlds["theirs"], name="Theirs")
    response = two_worlds["owner"].post(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/project-folders/",
        {"name": "Smuggled", "parent_id": str(theirs_folder.id)},
        format="json",
    )
    assert response.status_code == 404, (
        f"a folder in another workspace was accepted as a parent (got {response.status_code}). "
        "The sibling PATCH handler scopes the same id with workspace__slug=slug."
    )
    assert not ProjectFolder.objects.filter(
        workspace=two_worlds["ours"], parent_id=theirs_folder.id
    ).exists()


def test_deleting_a_folder_neither_refiles_nor_destroys_another_workspaces_children(two_worlds):
    """The other half of the same bug, and it has two wrong answers rather than one.

    Rows the unvalidated POST created already exist in a database that has been
    running this code, so delete has to cope with them. Promoting a foreign child
    files it under a folder in THIS workspace, which is the bug. Simply skipping
    it is worse: `parent` is on_delete=CASCADE, so the row and everything under it
    would be deleted because somebody tidied up somewhere they do own. It is
    detached to its own root, which is the only answer that loses nothing.
    """
    ours_folder = ProjectFolder.objects.create(workspace=two_worlds["ours"], name="Ours")
    stray = ProjectFolder.objects.create(
        workspace=two_worlds["theirs"], name="Stray", parent=ours_folder
    )
    response = two_worlds["owner"].delete(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/project-folders/{ours_folder.id}/"
    )
    assert response.status_code == 200
    assert ProjectFolder.objects.filter(id=stray.id).exists(), (
        "a folder in another workspace was cascade-deleted along with a folder in this one."
    )
    stray.refresh_from_db()
    assert stray.parent_id is None, (
        f"a folder in another workspace was re-filed under {stray.parent_id} by a delete in "
        "this one. The promotion update carries workspace__slug=slug; foreign children detach."
    )


# --- the role rule -----------------------------------------------------------


def test_a_project_guest_cannot_close_the_backlog_by_adopting_it(two_worlds):
    """The worst of the body-id endpoints, on the project they only watch.

    Adopting copies each named item into the target project and marks the
    ORIGINAL completed. The caller is a legitimate member of the target, so the
    decorator and the target check both pass; the only thing standing between a
    guest and a closed backlog is which queryset the SOURCE is looked up in.
    """
    response = two_worlds["guest"].post(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/adopt-issues/",
        {
            "source_issue_ids": [str(two_worlds["backlog"].id)],
            "target_project_id": str(two_worlds["worked"].id),
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["adopted"] == 0, (
        "a project GUEST adopted a work item out of the project they watch, which marks the "
        "original completed. Sources scope through _writable_projects."
    )
    two_worlds["backlog"].refresh_from_db()
    assert two_worlds["backlog"].completed_at is None


def test_adopting_still_works_for_somebody_who_belongs_to_both_projects(two_worlds):
    """The half that is easy to lose, on the endpoint with the most to lose it.

    `_writable_projects` is a narrower queryset than the one it replaces, and a
    narrowing that went one step too far — a missing workspace-admin fall-through,
    a join that matched the wrong membership row — would refuse everybody while
    every denial test above still passed.
    """
    response = two_worlds["owner"].post(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/adopt-issues/",
        {
            "source_issue_ids": [str(two_worlds["backlog"].id)],
            "target_project_id": str(two_worlds["worked"].id),
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["adopted"] == 1, response.content


def test_a_project_guest_cannot_adopt_into_the_project_they_watch(two_worlds):
    """And the same id in the other position: the target is written to as well."""
    mine = Issue.objects.create(
        project=two_worlds["worked"],
        workspace=two_worlds["ours"],
        name="Mine",
        created_by=two_worlds["backlog"].created_by,
    )
    response = two_worlds["guest"].post(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/adopt-issues/",
        {"source_issue_ids": [str(mine.id)], "target_project_id": str(two_worlds["watched"].id)},
        format="json",
    )
    assert response.status_code == 404, (
        f"a project GUEST had a work item created in the project they watch (got "
        f"{response.status_code}). The target scopes through _writable_projects."
    )


def test_a_project_guest_cannot_file_a_project_into_a_folder(two_worlds):
    """Filing is a change to the shared sidebar every member of the workspace reads.

    A guest was invited to follow one project, not to rearrange the cabinet it
    sits in — and this handler took the project id from the body, so the
    decorator on the URL had no project to ask about.
    """
    folder = ProjectFolder.objects.create(workspace=two_worlds["ours"], name="Programmes")
    response = two_worlds["guest"].put(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/project-folders/assign/",
        {"project_id": str(two_worlds["watched"].id), "folder_id": str(folder.id)},
        format="json",
    )
    assert response.status_code == 404, (
        f"a project GUEST filed the project they watch into a folder (got {response.status_code})."
    )
    assert not ProjectFolderItem.objects.filter(project_id=two_worlds["watched"].id).exists()


def test_a_project_guest_can_still_file_the_project_they_work_on(two_worlds):
    """The half that is easy to lose. Same caller, same endpoint, the other project.

    They are a MEMBER there, so nothing about this change may touch them — a
    guard that refused both would satisfy the assertion above and break the
    sidebar for everyone who uses it.
    """
    folder = ProjectFolder.objects.create(workspace=two_worlds["ours"], name="Programmes")
    response = two_worlds["guest"].put(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/project-folders/assign/",
        {"project_id": str(two_worlds["worked"].id), "folder_id": str(folder.id)},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert ProjectFolderItem.objects.filter(project_id=two_worlds["worked"].id).exists()


def test_a_project_guest_cannot_claim_a_repository_for_the_project_they_watch(two_worlds):
    """This endpoint's own docstring says it edits another project's configuration.

    It did that through `_visible_projects`. Claiming a repo for a project also
    STRIPS the link from every other project holding it, so a guest could reroute
    a team's GitHub issues onto somebody else's board.
    """
    response = two_worlds["guest"].post(
        f"/api/arribada/workspaces/{two_worlds['ours'].slug}/github-repo-claim/",
        {"repo": "arribada/linkit-v4-core", "project_id": str(two_worlds["watched"].id)},
        format="json",
    )
    assert response.status_code == 404, (
        f"a project GUEST claimed a repository for the project they watch (got "
        f"{response.status_code})."
    )


def test_a_project_guest_cannot_file_github_issues_into_the_project_they_watch(two_worlds):
    """Filing CREATES a work item, in a project named by the body.

    Asserted on both filing endpoints — the picker and the triage queue — because
    they took the same id from the same place through the same queryset, and
    fixing whichever one was reported would have left the other open.
    """
    slug = two_worlds["ours"].slug
    picker = two_worlds["guest"].post(
        f"/api/arribada/workspaces/{slug}/github-inbox/",
        {"ids": [str(uuid.uuid4())], "project_id": str(two_worlds["watched"].id)},
        format="json",
    )
    assert picker.status_code == 404, (
        f"the GitHub picker accepted a project a GUEST only watches (got {picker.status_code})."
    )

    queue = two_worlds["guest"].post(
        f"/api/arribada/workspaces/{slug}/github-triage-queue/",
        {"items": [{"id": str(uuid.uuid4()), "project_id": str(two_worlds["watched"].id)}]},
        format="json",
    )
    # This used to assert `200` with `filed == 0`, on the reasoning that the queue
    # answers per row and one bad entry must not discard a batch. The reasoning was
    # right about batches and wrong about refusals: the per-row skip was
    # indistinguishable from "this row had already been filed", and the page said so
    # out loud, in green — see test_refused_not_skipped.py. A permission refusal is
    # now a 403 taken before anything is written, and only the honest skips remain
    # in the counter.
    assert queue.status_code == 403, (
        f"the triage queue accepted a project the caller is only a GUEST of "
        f"(got {queue.status_code})."
    )
