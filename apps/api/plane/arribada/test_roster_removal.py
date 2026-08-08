# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Taking somebody off a project roster: who may, and how it is asked for.

`ProjectTeamEndpoint.put` was a full replace — `.exclude(id__in=keep).delete()` —
and two separate failures came out of that shape.

THE AUTHORITY. A plain project MEMBER could empty the whole roster in one
request. What that destroys is not recoverable from anywhere else in the product:
`leave`, `days_per_week` and `work_country` are stored here and only here, they
are what make a schedule fit the people who have to run it, and nobody types them
twice. No confirmation, no undo. The earlier permission pass closed the `is_lead`
escalation on this same handler and left this one open.

THE RACE. Deleting by omission means the payload has to be a complete picture of
the roster — but the client builds that picture when the editor opens. Two people
editing the team, or one tab left open since this morning, and Save silently
removes everybody added in between. That is not a permission problem: the lead
doing it has every right to remove people and did not intend to remove those.

So removal is now something the payload SAYS, in `remove: [id, ...]`, and it is
the lead's to say. Adding a person, fixing an address and recording a discipline
stay open to any member: those are the everyday edits and none of them destroy
anything.

Run explicitly: `python -m pytest plane/arribada/test_roster_removal.py`
"""

import pytest
from django.urls import reverse

from plane.arribada.models import ProjectTeamMember


@pytest.fixture
def roster(money_project):
    """Three people, one of them the lead. `lead` is a Plane account so
    `_is_project_lead` can recognise the caller; the other two need not be."""
    rows = {
        "lead": ProjectTeamMember.objects.create(
            project=money_project["project"],
            name="Ruby",
            email="lead@arribada.test",
            member=money_project["users"]["lead"],
            roles=["firmware"],
            is_lead=True,
        ),
        "grant": ProjectTeamMember.objects.create(
            project=money_project["project"],
            name="Grant",
            email="grant@arribada.test",
            roles=["hardware"],
            days_per_week=3,
            work_country="GB",
            leave=[{"start": "2027-02-01", "end": "2027-02-14"}],
        ),
        "sam": ProjectTeamMember.objects.create(
            project=money_project["project"], name="Sam", email="sam@arribada.test", roles=["software"]
        ),
    }
    money_project["rows"] = rows
    return money_project


def team_url(world):
    return reverse(
        "arribada-project-team",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


def row_payload(row):
    return {
        "id": str(row.id),
        "name": row.name,
        "email": row.email,
        "roles": row.roles,
        "is_lead": row.is_lead,
    }


def names(world):
    return set(
        ProjectTeamMember.objects.filter(project=world["project"]).values_list("name", flat=True)
    )


# --- omission is not removal -------------------------------------------------


def test_leaving_somebody_out_no_longer_deletes_them(roster):
    """The stale-tab case. Everything the payload does not mention belongs to
    somebody else's edit."""
    response = roster["clients"]["member"].put(
        team_url(roster), {"team": [row_payload(roster["rows"]["lead"])]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert names(roster) == {"Ruby", "Grant", "Sam"}, (
        "a payload naming one person deleted the other two. A tab opened this morning "
        "now removes everybody hired since."
    )


def test_a_stale_payload_does_not_delete_the_person_added_since_it_loaded(roster):
    """Two editors, stated as the sequence that actually happens: A opens the
    editor, B adds somebody and saves, A saves what A had."""
    stale = [row_payload(row) for row in roster["rows"].values()]

    added = roster["clients"]["member"].put(
        team_url(roster),
        {"team": [*stale, {"name": "Newcomer", "email": "new@arribada.test", "roles": ["design"]}]},
        format="json",
    )
    assert added.status_code == 200

    resaved = roster["clients"]["member"].put(team_url(roster), {"team": stale}, format="json")
    assert resaved.status_code == 200
    assert "Newcomer" in names(roster)


def test_an_ordinary_edit_is_still_an_ordinary_thing_for_a_member_to_do(roster):
    """The half that is easy to lose. A rule that refused every roster write
    would satisfy every removal test in this file and break the feature."""
    payload = row_payload(roster["rows"]["sam"])
    payload["roles"] = ["software", "review"]
    response = roster["clients"]["member"].put(team_url(roster), {"team": [payload]}, format="json")
    assert response.status_code == 200, response.data
    roster["rows"]["sam"].refresh_from_db()
    assert roster["rows"]["sam"].roles == ["software", "review"]


def test_a_member_may_still_add_somebody(roster):
    response = roster["clients"]["member"].put(
        team_url(roster),
        {"team": [{"name": "Newcomer", "email": "new@arribada.test", "roles": ["design"]}]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert "Newcomer" in names(roster)


# --- removal is named, and it is the lead's ----------------------------------


def test_a_member_may_not_remove_anybody(roster):
    response = roster["clients"]["member"].put(
        team_url(roster), {"team": [], "remove": [str(roster["rows"]["grant"].id)]}, format="json"
    )
    assert response.status_code == 403, response.data
    assert "Grant" in names(roster), (
        "a plain project member removed somebody from the roster. That row held the only "
        "copy of their leave, working pattern and holiday calendar."
    )


def test_the_lead_removes_the_person_they_named(roster):
    response = roster["clients"]["lead"].put(
        team_url(roster), {"team": [], "remove": [str(roster["rows"]["grant"].id)]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["removed"] == 1
    assert names(roster) == {"Ruby", "Sam"}


def test_a_row_that_is_both_written_and_removed_is_kept(roster):
    """The write is the more specific instruction. A client sending both gets
    the person kept rather than deleted by a list it forgot to update."""
    response = roster["clients"]["lead"].put(
        team_url(roster),
        {
            "team": [row_payload(roster["rows"]["grant"])],
            "remove": [str(roster["rows"]["grant"].id)],
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["removed"] == 0
    assert "Grant" in names(roster)


def test_an_id_naming_nobody_is_ignored_rather_than_refused(roster):
    """A client retrying a save it already made must not be handed an error for
    work that is already done."""
    import uuid

    response = roster["clients"]["lead"].put(
        team_url(roster), {"team": [], "remove": [str(uuid.uuid4())]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["removed"] == 0


def test_a_row_from_another_project_cannot_be_removed_through_this_one(roster):
    """`remove` is a list of ids from the client, so it is scoped to the project
    in the URL before anything is deleted."""
    from plane.db.models import Project, ProjectMember

    other = Project.objects.create(
        name="Elsewhere", workspace=roster["workspace"], created_by=roster["users"]["owner"], identifier="ELS"
    )
    ProjectMember.objects.create(
        project=other, workspace=roster["workspace"], member=roster["users"]["owner"], role=20
    )
    foreign = ProjectTeamMember.objects.create(project=other, name="Outsider", email="out@arribada.test")

    response = roster["clients"]["lead"].put(
        team_url(roster), {"team": [], "remove": [str(foreign.id)]}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["removed"] == 0
    assert ProjectTeamMember.objects.filter(id=foreign.id).exists()


def test_what_a_removal_destroys_is_stated_here_so_the_guard_is_not_softened(roster):
    """Not a behaviour test — a record of why removal is lead-only.

    These three columns exist nowhere else in the product and nothing else can
    reconstruct them. If a future change makes removals a member's again, this
    assertion is where the cost of that is written down.
    """
    grant = roster["rows"]["grant"]
    assert (grant.days_per_week, grant.work_country, grant.leave) == (
        3,
        "GB",
        [{"start": "2027-02-01", "end": "2027-02-14"}],
    )
    roster["clients"]["lead"].put(
        team_url(roster), {"team": [], "remove": [str(grant.id)]}, format="json"
    )
    assert not ProjectTeamMember.objects.filter(id=grant.id).exists()
