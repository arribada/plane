# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Making oneself the lead through the roster, without touching the lead flag.

`_is_project_lead` asks for a roster row with `is_lead=True` AND `member_id ==
caller`. The roster PUT guarded the FLAG: a request that changed `is_lead` on any
row went to `_lead_guard`. It did not guard the ACCOUNT. A row that was already
the lead could have its `member_id` re-pointed at the caller — or its `email`,
from which the account is resolved when no member_id is sent — and the flag
never moved, so the guard never fired. One PUT, by any project member, and
governance, allocation, the expense sheet and procurement all answered to them.

So a change of who a lead row points at is a lead change, and it is the lead's.
The everyday edit — a member correcting the lead's disciplines — sends the same
account and the same address and still passes; the last test here is the one
that keeps the guard from being tightened into "nobody may touch the lead row".

Run explicitly: `python -m pytest plane/arribada/test_roster_lead_takeover.py`
"""

import pytest
from django.urls import reverse

from plane.arribada.models import ProjectTeamMember
from plane.arribada.views import _is_project_lead


@pytest.fixture
def led(money_project):
    """A roster with one lead, who is a Plane account the predicate can see."""
    row = ProjectTeamMember.objects.create(
        project=money_project["project"],
        name="Ruby",
        email="lead@arribada.test",
        member=money_project["users"]["lead"],
        roles=["firmware"],
        is_lead=True,
    )
    assert _is_project_lead(money_project["users"]["lead"], money_project["project_id"])
    assert not _is_project_lead(money_project["users"]["member"], money_project["project_id"])
    return {**money_project, "lead_row": row}


def team_url(world):
    return reverse(
        "arribada-project-team",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


def lead_row_as(world, **changes):
    """The lead's row as the editor would send it back, with `changes` applied."""
    row = world["lead_row"]
    payload = {
        "id": str(row.id),
        "name": row.name,
        "email": row.email,
        "member_id": str(row.member_id),
        "roles": row.roles,
        "is_lead": True,
    }
    payload.update(changes)
    return payload


def test_a_member_cannot_point_the_lead_row_at_themselves_by_member_id(led):
    """The flag is untouched, so the old guard saw nothing to guard."""
    me = led["users"]["member"]
    response = led["clients"]["member"].put(
        team_url(led), {"team": [lead_row_as(led, member_id=str(me.id))]}, format="json"
    )

    assert response.status_code == 403, response.data
    led["lead_row"].refresh_from_db()
    assert led["lead_row"].member_id == led["users"]["lead"].id, "the lead row was re-pointed"
    assert led["lead_row"].is_lead is True
    assert not _is_project_lead(me, led["project_id"]), (
        "a project member made themselves the lead with one roster PUT"
    )


def test_a_member_cannot_point_the_lead_row_at_themselves_by_email(led):
    """No member_id sent: the account is resolved from the address, which is the
    key the roster exists to link on — and so the other way in."""
    me = led["users"]["member"]
    payload = lead_row_as(led, email=me.email)
    del payload["member_id"]
    response = led["clients"]["member"].put(team_url(led), {"team": [payload]}, format="json")

    assert response.status_code == 403, response.data
    led["lead_row"].refresh_from_db()
    assert led["lead_row"].email == "lead@arribada.test"
    assert led["lead_row"].member_id == led["users"]["lead"].id
    assert not _is_project_lead(me, led["project_id"])


def test_the_lead_may_hand_the_row_to_somebody_else(led):
    """Same request from the lead: a handover, which is exactly what the lead is
    for. And the handover takes: the new person answers the predicate afterwards."""
    successor = led["users"]["member"]
    response = led["clients"]["lead"].put(
        team_url(led),
        {"team": [lead_row_as(led, name="Sam", email=successor.email, member_id=str(successor.id))]},
        format="json",
    )

    assert response.status_code == 200, response.data
    led["lead_row"].refresh_from_db()
    assert led["lead_row"].member_id == successor.id
    assert _is_project_lead(successor, led["project_id"])
    assert not _is_project_lead(led["users"]["lead"], led["project_id"])


def test_a_member_may_still_edit_the_leads_disciplines(led):
    """The guard must not become "nobody but the lead may touch the lead row".

    Same account, same address, different roles: the everyday edit, and the one
    a too-wide fix would have broken for every project on the instance.
    """
    response = led["clients"]["member"].put(
        team_url(led), {"team": [lead_row_as(led, roles=["firmware", "review"])]}, format="json"
    )

    assert response.status_code == 200, response.data
    led["lead_row"].refresh_from_db()
    assert led["lead_row"].roles == ["firmware", "review"]
    assert led["lead_row"].member_id == led["users"]["lead"].id


def test_a_member_may_still_edit_the_lead_row_without_resending_the_member_id(led):
    """The editor built from the GET carries member_id, but an older client may
    not. The address resolves to the same account, so nothing changed."""
    payload = lead_row_as(led, roles=["firmware", "hardware"])
    del payload["member_id"]
    response = led["clients"]["member"].put(team_url(led), {"team": [payload]}, format="json")

    assert response.status_code == 200, response.data
    led["lead_row"].refresh_from_db()
    assert led["lead_row"].member_id == led["users"]["lead"].id
