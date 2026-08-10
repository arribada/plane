# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Two surfaces that told a non-admin something untrue, and cost trust for nothing.

**Triage filing.** `WorkspaceGithubTriageQueueEndpoint.post` silently incremented
`skipped` for a project the caller could not write to. The picker was populated
from `_visible_projects`, which admits a GUEST, so the dropdown OFFERED destinations
the POST was guaranteed to refuse; the page then explained the whole `skipped`
number in a **green success toast** as "N were left — they had already been filed
elsewhere", which it had no way of knowing and which was, for a refused project,
simply false. Somebody triaging a morning's backlog was told their work had landed
when none of it had.

Three changes, all pinned below: the picker offers only what can be filed into, a
refusal is a 403 and not a counter, and the refusal is all-or-nothing so the caller
never has to work out which half of a batch survived.

**The Home sync button.** `WorkspaceGithubInboxGapEndpoint` picks a project purely
to anchor `GithubSyncNowEndpoint`'s permission check. It picked with
`_visible_projects(...).first()` and no `order_by`, which is wrong twice: the
endpoint requires ADMIN or MEMBER while `_visible_projects` admits a GUEST, and an
unordered `.first()` over a join has no defined answer — so which project gated the
button changed between calls, making the 403 unreproducible on top of being wrong.

Run explicitly: `python -m pytest plane/arribada/test_refused_not_skipped.py`
"""

import pytest
from django.urls import reverse

from plane.app.permissions import ROLE
from plane.arribada.models import GithubIssue
from plane.db.models import Project, ProjectMember, User, WorkspaceMember


@pytest.fixture
def triage(money_project):
    """The caller is a MEMBER of one project and a GUEST of another, plus one
    captured GitHub issue waiting to be filed.

    A guest membership rather than no membership at all, on purpose: no membership
    is a 404 and was never the confusing case. A guest SEES the project, so the
    picker offered it, and the refusal that followed was reported as a success.
    """
    workspace = money_project["workspace"]
    other = Project.objects.create(
        name="Someone else's", workspace=workspace, created_by=money_project["users"]["owner"], identifier="ELSE"
    )
    ProjectMember.objects.create(
        project=other,
        workspace=workspace,
        member=money_project["users"]["member"],
        role=ROLE.GUEST.value,
    )
    row = GithubIssue.objects.create(
        workspace=workspace,
        repo="arribada/linkit-v4-core",
        number=41,
        title="Saltwater switch bounces",
        html_url="https://github.com/arribada/linkit-v4-core/issues/41",
    )
    return {**money_project, "guest_project": other, "github_row": row}


def queue_url(world):
    return reverse("arribada-github-triage-queue", kwargs={"slug": world["slug"]})


def gap_url(world):
    return reverse("arribada-github-inbox-gap", kwargs={"slug": world["slug"]})


# --- filing: refused, not counted --------------------------------------------


def test_filing_into_a_project_you_cannot_write_to_is_refused_not_skipped(triage):
    """The whole bug in one assertion. A 200 with `skipped: 1` is what the page
    turned into "already filed elsewhere", in green."""
    response = triage["clients"]["member"].post(
        queue_url(triage),
        {"items": [{"id": str(triage["github_row"].id), "project_id": str(triage["guest_project"].id)}]},
        format="json",
    )
    assert response.status_code == 403
    assert "error" in response.data
    triage["github_row"].refresh_from_db()
    assert triage["github_row"].filed_issue_id is None


def test_the_refusal_names_the_project_rather_than_its_uuid(triage):
    """A toast reading "you cannot file into 3f2a…" tells the reader nothing they
    can act on. The caller can see this project, so it can be named."""
    response = triage["clients"]["member"].post(
        queue_url(triage),
        {"items": [{"id": str(triage["github_row"].id), "project_id": str(triage["guest_project"].id)}]},
        format="json",
    )
    assert response.status_code == 403
    assert "Someone else's" in response.data["error"]


def test_one_refused_entry_files_none_of_the_batch(triage):
    """All-or-nothing on purpose. A batch half-filed and half-refused leaves the
    caller no way of knowing which half without re-reading the queue — and the
    queue is exactly what they were trying to clear."""
    good = GithubIssue.objects.create(
        workspace=triage["workspace"],
        repo="arribada/linkit-v4-core",
        number=42,
        title="GNSS fix takes four minutes",
        html_url="https://github.com/arribada/linkit-v4-core/issues/42",
    )
    response = triage["clients"]["member"].post(
        queue_url(triage),
        {
            "items": [
                {"id": str(good.id), "project_id": triage["project_id"]},
                {"id": str(triage["github_row"].id), "project_id": str(triage["guest_project"].id)},
            ]
        },
        format="json",
    )
    assert response.status_code == 403
    good.refresh_from_db()
    assert good.filed_issue_id is None, "a refused entry must not leave half a batch filed"


def test_filing_into_a_project_you_can_write_to_still_works(triage):
    """The other direction, without which every assertion above would also pass on
    an endpoint that had simply started refusing everybody."""
    response = triage["clients"]["member"].post(
        queue_url(triage),
        {"items": [{"id": str(triage["github_row"].id), "project_id": triage["project_id"]}]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["filed"] == 1
    assert response.data["skipped"] == 0
    triage["github_row"].refresh_from_db()
    assert triage["github_row"].filed_issue_id is not None


def test_an_already_filed_row_is_still_a_plain_skip(triage):
    """`skipped` keeps its honest meaning: the row left the queue under us. That is
    the only thing the page may now explain that way."""
    triage["clients"]["member"].post(
        queue_url(triage),
        {"items": [{"id": str(triage["github_row"].id), "project_id": triage["project_id"]}]},
        format="json",
    )
    again = triage["clients"]["member"].post(
        queue_url(triage),
        {"items": [{"id": str(triage["github_row"].id), "project_id": triage["project_id"]}]},
        format="json",
    )
    assert again.status_code == 200
    assert again.data["filed"] == 0
    assert again.data["skipped"] == 1


# --- the picker offers only what the POST accepts ----------------------------


def test_the_picker_does_not_offer_a_project_the_caller_cannot_file_into(triage):
    listing = triage["clients"]["member"].get(queue_url(triage))
    assert listing.status_code == 200
    offered = {p["id"] for p in listing.data["projects"]}
    assert triage["project_id"] in offered
    assert str(triage["guest_project"].id) not in offered


def test_a_contested_repo_still_names_every_claimant(triage):
    """`claimed_by` is a fact about the repo, not about the reader's permissions.
    Filtering it to writable projects would make a contested row look uncontested,
    which is the one thing that row exists to say."""
    from plane.arribada.models import ProjectWikiDoc

    for project in (triage["project"], triage["guest_project"]):
        ProjectWikiDoc.objects.update_or_create(
            project=project,
            defaults={"github_repo_urls": ["https://github.com/arribada/linkit-v4-core"]},
        )
    listing = triage["clients"]["member"].get(queue_url(triage))
    assert listing.status_code == 200
    row = next(i for i in listing.data["items"] if i["id"] == str(triage["github_row"].id))
    assert {c["id"] for c in row["claimed_by"]} == {triage["project_id"], str(triage["guest_project"].id)}


# --- the Home sync button's anchor -------------------------------------------


def test_the_sync_anchor_is_a_project_the_caller_may_actually_sync(triage):
    """The button is only ever offered when this id is present, so an id that 403s
    is a button that can only fail."""
    response = triage["clients"]["member"].get(gap_url(triage))
    assert response.status_code == 200
    assert response.data["sync_project_id"] == triage["project_id"]


def test_the_sync_anchor_is_the_same_project_every_time(triage):
    """`.first()` with no `order_by` has no defined answer. Two reads that disagree
    make the resulting 403 unreproducible, which is how it survived."""
    client = triage["clients"]["member"]
    answers = {client.get(gap_url(triage)).data["sync_project_id"] for _ in range(4)}
    assert len(answers) == 1


def test_a_guest_on_every_project_is_offered_no_sync_button_at_all(triage):
    """Better than an anchor that 403s: the widget hides the button when this is
    null, so "you cannot do this" is said by not offering it.

    A workspace MEMBER who is a guest on every project — the endpoint itself is
    workspace-level and lets them read the widget, which is exactly the case the
    old `_visible_projects` anchor handed a project id that could only be refused.
    """
    onlooker = User.objects.create(email="onlooker@arribada.test", username="tr-guest", first_name="Guest")
    WorkspaceMember.objects.create(
        workspace=triage["workspace"], member=onlooker, role=ROLE.MEMBER.value
    )
    ProjectMember.objects.create(
        project=triage["project"], workspace=triage["workspace"], member=onlooker, role=ROLE.GUEST.value
    )
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=onlooker)
    response = client.get(gap_url(triage))
    assert response.status_code == 200
    assert response.data["sync_project_id"] is None
