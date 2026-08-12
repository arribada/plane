# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What a baseline locks, and what it does not.

The report was that saving a baseline appeared to freeze everything. It does not
and never did — `timeline_locked` lives on `ProjectSchedule` and the capture
endpoint never touches it — but "it does not" is exactly the kind of claim that
is true until somebody adds one line to the wrong handler. So the independence is
pinned here rather than asserted in a handover document.

The rest of the file is the shape a user asked for in their own words: hold
several baselines, keep editing the live plan, switch between them, and see the
right one. Three of those are properties of THIS endpoint; the fourth — that the
picker and the ghost bars agree about which one is selected — is a client
question and lives in `baseline-selection.test.ts`, because the failure was that
the two halves disagreed.

Run explicitly: `python -m pytest plane/arribada/test_baseline_lock.py`
"""

from datetime import date, datetime, timezone

import pytest
from django.urls import reverse


def date_time(year, month, day):
    """An aware datetime, because USE_TZ is on and a naive one warns."""
    return datetime(year, month, day, 12, 0, tzinfo=timezone.utc)

from plane.arribada.models import ProjectBaseline, ProjectSchedule
from plane.db.models import Issue


@pytest.fixture
def planned(money_project):
    """A project with two dated work items and no schedule row yet."""
    first = Issue.objects.create(
        name="Design the enclosure",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        start_date=date(2027, 3, 1),
        target_date=date(2027, 3, 5),
    )
    second = Issue.objects.create(
        name="Mould trial",
        project=money_project["project"],
        workspace=money_project["workspace"],
        state=money_project["state"],
        start_date=date(2027, 3, 8),
        target_date=date(2027, 3, 12),
    )
    return {**money_project, "first": first, "second": second}


def baseline_url(world):
    return reverse("arribada-project-baseline", args=[world["slug"], world["project_id"]])


def test_capturing_a_baseline_does_not_lock_the_plan(planned):
    """The whole of the first half of the report, in one assertion.

    A snapshot is a record of what was promised. Freezing the plan is a separate,
    deliberate act with its own control — and one that applies to the lead too.
    Conflating them would mean nobody could ever record a promise without also
    stopping work on it.
    """
    client = planned["clients"]["owner"]
    response = client.post(baseline_url(planned), {"name": "PDR January"}, format="json")
    assert response.status_code == 201

    schedule = ProjectSchedule.objects.filter(project_id=planned["project_id"]).first()
    # Either no schedule row at all, or one that is still unlocked. Both mean the
    # same thing to the client, which reads a missing row as unlocked.
    assert schedule is None or schedule.timeline_locked is False


def test_a_locked_plan_does_not_stop_a_new_baseline_being_taken(planned):
    """The mirror. A lock says "these dates are agreed"; recording that they were
    agreed is the one thing it must not prevent."""
    ProjectSchedule.objects.create(project_id=planned["project_id"], timeline_locked=True)
    client = planned["clients"]["owner"]
    response = client.post(baseline_url(planned), {"name": "After amendment 2"}, format="json")
    assert response.status_code == 201


def test_several_baselines_coexist_and_none_overwrites_another(planned):
    """Re-capturing used to overwrite: a project frozen in January and again in
    March could not show a funder what January said."""
    client = planned["clients"]["owner"]
    assert client.post(baseline_url(planned), {"name": "January"}, format="json").status_code == 201

    # The live plan moves between the two captures — this IS the editing the user
    # asked to still be possible while a baseline exists.
    Issue.objects.filter(id=planned["second"].id).update(
        start_date=date(2027, 4, 5), target_date=date(2027, 4, 9)
    )

    assert client.post(baseline_url(planned), {"name": "March"}, format="json").status_code == 201
    assert ProjectBaseline.objects.filter(project_id=planned["project_id"]).count() == 2


def test_each_baseline_keeps_the_dates_it_was_taken_with(planned):
    """Switching between them shows different plans, or holding two is pointless."""
    client = planned["clients"]["owner"]
    january = client.post(baseline_url(planned), {"name": "January"}, format="json").json()

    Issue.objects.filter(id=planned["second"].id).update(
        start_date=date(2027, 4, 5), target_date=date(2027, 4, 9)
    )
    march = client.post(baseline_url(planned), {"name": "March"}, format="json").json()

    def entry_for(baseline_id, issue_id):
        payload = client.get(baseline_url(planned), {"baseline": baseline_id}).json()
        assert payload["selected"] == baseline_id
        return next(e for e in payload["entries"] if e["issue_id"] == str(issue_id))

    assert entry_for(january["id"], planned["second"].id)["start_date"] == "2027-03-08"
    assert entry_for(march["id"], planned["second"].id)["start_date"] == "2027-04-05"


def test_the_newest_is_what_you_get_without_asking(planned):
    client = planned["clients"]["owner"]
    january = client.post(baseline_url(planned), {"name": "January"}, format="json").json()
    march = client.post(baseline_url(planned), {"name": "March"}, format="json").json()
    # `captured_at` is auto_now_add and both of these are created inside one test,
    # so the ordering they are asserted on has to be made real rather than assumed.
    # `.update()` is the only way past auto_now_add.
    ProjectBaseline.objects.filter(id=january["id"]).update(captured_at=date_time(2027, 1, 15))
    ProjectBaseline.objects.filter(id=march["id"]).update(captured_at=date_time(2027, 3, 15))

    payload = client.get(baseline_url(planned)).json()
    assert payload["selected"] == march["id"]
    assert [b["name"] for b in payload["baselines"]] == ["March", "January"]


def test_an_unknown_baseline_id_falls_back_to_the_newest_rather_than_drawing_nothing(planned):
    """A stale id — another project's, or one just deleted — must not empty the
    chart. The client clears its own stale selection so the picker agrees with
    what is drawn; this is the server half of that contract."""
    client = planned["clients"]["owner"]
    march = client.post(baseline_url(planned), {"name": "March"}, format="json").json()

    payload = client.get(baseline_url(planned), {"baseline": "00000000-0000-0000-0000-000000000000"}).json()
    assert payload["selected"] == march["id"]
    assert len(payload["entries"]) == 2


def test_deleting_one_baseline_leaves_the_others_alone(planned):
    client = planned["clients"]["owner"]
    january = client.post(baseline_url(planned), {"name": "January"}, format="json").json()
    march = client.post(baseline_url(planned), {"name": "March"}, format="json").json()

    assert client.delete(baseline_url(planned), {"id": january["id"]}, format="json").status_code == 200
    remaining = client.get(baseline_url(planned)).json()
    assert [b["id"] for b in remaining["baselines"]] == [march["id"]]
