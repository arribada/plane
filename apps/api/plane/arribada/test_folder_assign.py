# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Filing a project into a folder, including a folder that is itself nested.

This endpoint had no test at all, which mattered when the sidebar stopped filing
projects: there was no way to say from the repository whether the drop was
failing in the browser or being refused by the server. It was the browser — it
sent `project_id: null` — but proving that took a session of guessing that this
file now makes unnecessary.

The nesting is the case worth pinning. `test_folder_tree.py` covers the rule that
keeps FOLDERS a tree; nothing covered a PROJECT going into a child folder, and
the two are easy to conflate. There is no depth logic in this endpoint on
purpose: a project belongs to at most one folder, enforced by a OneToOne on
ProjectFolderItem, and which folder that is has never had anything to do with how
deep the folder sits. The tests below say so out loud, so that a later change
that starts caring about depth — refusing a non-root target, or filing into the
root of the target's branch — breaks here rather than in the sidebar.

Needs a database: the whole subject is which row exists afterwards.

Run explicitly: `python -m pytest plane/arribada/test_folder_assign.py`
"""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from plane.app.permissions import ROLE
from plane.arribada.models import ProjectFolder, ProjectFolderItem
from plane.db.models import Project, ProjectMember, User, Workspace, WorkspaceMember


@pytest.fixture
def folder_world(db):
    """The tree from the bug report.

        Tracker            <- top level, holds the three loose projects
          Turtles          <- nested, empty
        Field ops          <- an unrelated top-level folder

    Plus a second workspace with a folder of its own, which exists only so that
    "the folder must belong to this workspace" is tested against a folder that
    really is somebody else's rather than a made-up uuid.
    """
    owner = User.objects.create(email="folders@plane.so", username="folder-owner", first_name="Owner")
    owner.set_password("x")
    owner.save()
    workspace = Workspace.objects.create(name="Folders WS", owner=owner, slug="folders-ws")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    project = Project.objects.create(name="Sea Turtle Tag Camera", workspace=workspace, created_by=owner, identifier="CAM")
    ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=ROLE.ADMIN.value)

    tracker = ProjectFolder.objects.create(workspace=workspace, name="Tracker")
    turtles = ProjectFolder.objects.create(workspace=workspace, name="Turtles", parent=tracker)
    field_ops = ProjectFolder.objects.create(workspace=workspace, name="Field ops")

    other_owner = User.objects.create(email="other@plane.so", username="folder-other", first_name="Other")
    other_owner.set_password("x")
    other_owner.save()
    other_ws = Workspace.objects.create(name="Other WS", owner=other_owner, slug="other-ws")
    someone_elses = ProjectFolder.objects.create(workspace=other_ws, name="Not ours")

    client = APIClient()
    client.force_authenticate(user=owner)
    return {
        "client": client,
        "url": reverse("arribada-project-folder-assign", kwargs={"slug": workspace.slug}),
        "list_url": reverse("arribada-project-folders", kwargs={"slug": workspace.slug}),
        "project": project,
        "tracker": tracker,
        "turtles": turtles,
        "field_ops": field_ops,
        "someone_elses": someone_elses,
    }


def _assign(world, folder):
    return world["client"].put(
        world["url"],
        {"project_id": str(world["project"].id), "folder_id": str(folder.id) if folder else None},
        format="json",
    )


def _folder_of(world):
    item = ProjectFolderItem.objects.filter(project_id=world["project"].id).first()
    return item.folder_id if item else None


# --- the reported gesture ----------------------------------------------------


def test_a_project_files_into_a_nested_folder(folder_world):
    """Dropping "Sea Turtle Tag Camera" on "Turtles", which lives under "Tracker"."""
    response = _assign(folder_world, folder_world["turtles"])

    assert response.status_code == 200, response.data
    assert _folder_of(folder_world) == folder_world["turtles"].id


def test_a_project_files_into_a_top_level_folder(folder_world):
    """The control. If this one ever fails while the nested case passes, the
    endpoint has grown depth logic that nobody asked it for."""
    response = _assign(folder_world, folder_world["field_ops"])

    assert response.status_code == 200, response.data
    assert _folder_of(folder_world) == folder_world["field_ops"].id


def test_a_project_moves_from_a_parent_into_its_own_subfolder(folder_world):
    """The move, not the first filing — the ordinary way this gets used.

    A project belongs to at most one folder (ProjectFolderItem.project is a
    OneToOne), so this has to UPDATE the row rather than add one; a plain
    `create` would raise IntegrityError and a plain `create` after a `delete`
    would lose the sort order. Moving into the CHILD of the folder it is already
    in is the case where an ancestor check written the wrong way round would
    refuse a perfectly ordinary drop.
    """
    _assign(folder_world, folder_world["tracker"])

    response = _assign(folder_world, folder_world["turtles"])

    assert response.status_code == 200, response.data
    assert ProjectFolderItem.objects.filter(project_id=folder_world["project"].id).count() == 1
    assert _folder_of(folder_world) == folder_world["turtles"].id


# --- what the sidebar then reads ---------------------------------------------


def test_the_listing_puts_the_project_under_the_child_and_not_the_parent(folder_world):
    """The sidebar counts a parent as holding its subtree, but the PAYLOAD is per
    folder: a project filed in "Turtles" must appear in Turtles' project_ids and
    nowhere else, or it renders twice."""
    _assign(folder_world, folder_world["turtles"])

    body = {f["id"]: f for f in folder_world["client"].get(folder_world["list_url"]).data}

    assert body[str(folder_world["turtles"].id)]["project_ids"] == [str(folder_world["project"].id)]
    assert body[str(folder_world["tracker"].id)]["project_ids"] == []
    # And the parent link is what makes it a subfolder rather than a third root.
    assert body[str(folder_world["turtles"].id)]["parent_id"] == str(folder_world["tracker"].id)


def test_a_project_can_be_taken_back_out_of_a_folder(folder_world):
    """`folder_id: null` unfiles it. The sidebar sends this when a project is
    dropped on the FOLDERS header, or the × on its row is pressed."""
    _assign(folder_world, folder_world["turtles"])

    response = _assign(folder_world, None)

    assert response.status_code == 200, response.data
    assert _folder_of(folder_world) is None


# --- and what it refuses -----------------------------------------------------


def test_a_missing_project_id_is_refused(folder_world):
    """The exact request the broken sidebar was sending on every drop.

    It is right to refuse it. Pinned because the 400 is the only reason the bug
    was a no-op rather than a project filed under a null id, and because a future
    `project_id = request.data.get("project_id") or some_default` would turn a
    loud refusal into a silent wrong write.
    """
    response = folder_world["client"].put(
        folder_world["url"], {"project_id": None, "folder_id": str(folder_world["turtles"].id)}, format="json"
    )

    assert response.status_code == 400
    assert ProjectFolderItem.objects.filter(project_id=folder_world["project"].id).count() == 0


def test_a_folder_from_another_workspace_is_refused(folder_world):
    """Folders are workspace-shared, so the folder id in the body has to be
    checked against the slug in the URL rather than trusted."""
    response = _assign(folder_world, folder_world["someone_elses"])

    assert response.status_code == 404
    assert _folder_of(folder_world) is None
