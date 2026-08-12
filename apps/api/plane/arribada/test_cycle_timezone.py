# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A sprint starts on the day somebody typed, not on the day UTC agrees with.

`Cycle.start_date` and `Cycle.end_date` are the only plan dates in this fork that
are not plain days. Everything else — a work item's start and target, an expense
date, the project window, a rate capture — is a `DateField` and reads the same
everywhere on earth. Cycles are upstream `DateTimeField`s, and upstream writes
them from a typed day through `convert_to_utc`: the start at project-local
midnight PLUS ONE SECOND, the end at project-local 23:59.

So `.date()` on the stored value is the UTC day, and the two ends fail in
opposite directions:

    project timezone      typed         stored                .date() said
    ───────────────────   ───────────   ───────────────────   ────────────
    Pacific/Auckland      start 2 Mar   2026-03-01 11:00:01Z  1 March   ✗
    America/Los_Angeles   end  31 Mar   2026-04-01 06:59:00Z  1 April   ✗

Both sites in this fork that read a cycle boundary took `.date()`, while
upstream's own Cycles page converts to the project timezone first
(`user_timezone_converter`, plane/app/views/cycle/base.py). One sprint therefore
showed two different start dates on two pages of the same product — and the wrong
one is the one that reaches the Finance per-sprint table and the printed cost
annex, where a funder is in no position to check it against anything.

`cycle_day` is that conversion, once, at the API edge. The datetimes below are
built the way `convert_to_utc` builds them rather than copied out of it, so this
file states the fact and does not merely agree with the code.

Run explicitly: `python -m pytest plane/arribada/test_cycle_timezone.py`
"""

from datetime import datetime

import pytest
import pytz
from django.urls import reverse

from plane.app.permissions import ROLE
from plane.arribada import views
from plane.arribada.views import cycle_day
from plane.db.models import Cycle, Project, ProjectMember, State

# Twelve or thirteen hours ahead of UTC: far enough east that a project-local
# morning is still yesterday in Greenwich. It is also one of the two zones the CI
# job runs the web suite under, for exactly this reason.
AUCKLAND = "Pacific/Auckland"
# And the mirror image, where a project-local evening is already tomorrow.
LOS_ANGELES = "America/Los_Angeles"


def stored_start(day, zone):
    """What upstream's `convert_to_utc` puts in the column for a typed start day.

    Project-local midnight plus one second, converted to UTC.
    """
    local = pytz.timezone(zone)
    return local.localize(datetime(day.year, day.month, day.day, 0, 0, 1)).astimezone(pytz.utc)


def stored_end(day, zone):
    """And for a typed end day: project-local 23:59, converted to UTC."""
    local = pytz.timezone(zone)
    return local.localize(datetime(day.year, day.month, day.day, 23, 59, 0)).astimezone(pytz.utc)


@pytest.fixture
def elsewhere(money_project):
    """A second project in the same workspace, running on the other side of the world.

    A separate project rather than a mutated fixture: `Project.save` only honours
    a timezone that was passed at creation (`is_timezone_provided`), and the rest
    of the suite depends on the fixture project staying at UTC.
    """

    def project_in(zone, identifier):
        project = Project.objects.create(
            name=f"Tag {identifier}",
            workspace=money_project["workspace"],
            created_by=money_project["users"]["owner"],
            identifier=identifier,
            timezone=zone,
        )
        ProjectMember.objects.create(
            project=project,
            workspace=money_project["workspace"],
            member=money_project["users"]["owner"],
            role=ROLE.ADMIN.value,
        )
        State.objects.create(
            name="Backlog",
            project=project,
            workspace=money_project["workspace"],
            group="backlog",
            default=True,
            sequence=1,
        )
        assert project.timezone == zone, "Project.save overrode the timezone"
        return project

    def sprint(project, name="Sprint 1", start=None, end=None):
        return Cycle.objects.create(
            name=name,
            project=project,
            workspace=money_project["workspace"],
            owned_by=money_project["users"]["owner"],
            start_date=start,
            end_date=end,
        )

    money_project["project_in"] = project_in
    money_project["sprint"] = sprint
    return money_project


# --- the conversion itself ---------------------------------------------------


def test_a_sprint_starting_at_project_midnight_reports_the_project_day(elsewhere):
    """The bug, stated as arithmetic and then as the fix."""
    project = elsewhere["project_in"](AUCKLAND, "AKL")
    typed = datetime(2026, 3, 2).date()
    stored = stored_start(typed, AUCKLAND)

    # The premise: what the column holds really is the day before.
    assert stored.date() != typed
    assert stored.date().isoformat() == "2026-03-01"

    cycle = elsewhere["sprint"](project, start=stored)
    assert cycle_day(cycle, project) == typed


def test_a_sprint_ending_late_in_the_evening_reports_the_project_day(elsewhere):
    """The other end, and the other direction.

    A western project's 23:59 is already tomorrow in UTC, so the end date walked
    forward where the start date walked back. One helper covers both because it is
    one fact.
    """
    project = elsewhere["project_in"](LOS_ANGELES, "LAX")
    typed = datetime(2026, 3, 31).date()
    stored = stored_end(typed, LOS_ANGELES)

    assert stored.date().isoformat() == "2026-04-01"

    cycle = elsewhere["sprint"](project, end=stored)
    assert cycle_day(cycle, project, "end_date") == typed


def test_a_utc_project_is_left_exactly_where_it_was(elsewhere):
    """The control, and the reason the existing suite stays green.

    Every project on this instance is UTC today, which is precisely why the defect
    survived: the only configuration anybody tested is the one where the two
    answers coincide.
    """
    project = elsewhere["project_in"]("UTC", "UTC1")
    cycle = elsewhere["sprint"](
        project,
        start=datetime(2026, 1, 1, 0, 0, 1, tzinfo=pytz.utc),
        end=datetime(2026, 2, 28, 23, 59, tzinfo=pytz.utc),
    )
    assert cycle_day(cycle, project).isoformat() == "2026-01-01"
    assert cycle_day(cycle, project, "end_date").isoformat() == "2026-02-28"


def test_a_sprint_with_no_dates_reports_nothing(elsewhere):
    """Cycles are routinely created undated, and a helper that raised on one would
    take down the Overview page for the project that has one."""
    project = elsewhere["project_in"](AUCKLAND, "AKL2")
    cycle = elsewhere["sprint"](project)
    assert cycle_day(cycle, project) is None
    assert cycle_day(cycle, project, "end_date") is None


def test_an_unknown_project_timezone_falls_back_to_utc_instead_of_raising(elsewhere):
    """`Project.timezone` has choices, which the database does not enforce.

    A row carrying a zone this build's tz database has never heard of must cost
    this reading its accuracy — not cost the Overview page and the Finance page a
    500 apiece.
    """
    project = elsewhere["project_in"]("UTC", "ODD")
    # Set after creation, which is exactly how a bad value gets in: an import, a
    # migration, or a tz database that dropped a name.
    Project.objects.filter(id=project.id).update(timezone="Mars/Olympus_Mons")
    project.refresh_from_db()

    cycle = elsewhere["sprint"](project, start=datetime(2026, 3, 1, 11, 0, 1, tzinfo=pytz.utc))
    assert cycle_day(cycle, project).isoformat() == "2026-03-01"


# --- the two surfaces that were reading it wrong ------------------------------


def test_the_finance_per_sprint_table_reports_the_project_day(elsewhere):
    """`_cost_by_cycle` — the row that reaches the budget page and the cost annex."""
    project = elsewhere["project_in"](AUCKLAND, "FIN")
    elsewhere["sprint"](
        project,
        name="Sprint 1",
        start=stored_start(datetime(2026, 3, 2).date(), AUCKLAND),
        end=stored_end(datetime(2026, 3, 27).date(), AUCKLAND),
    )

    payload = views._cost_by_cycle(project.id, {}, {}, "EUR", [])
    # By name, not by position: the unsprinted bucket rides in the same list.
    row = next(r for r in payload["cycles"] if r["name"] == "Sprint 1")
    assert (row["start_date"], row["end_date"]) == ("2026-03-02", "2026-03-27")


def test_the_overview_page_reports_the_project_day(elsewhere):
    """The other site, and the one that made the disagreement visible: this page
    and upstream's Sprints page showed two different start dates for one sprint."""
    project = elsewhere["project_in"](AUCKLAND, "OVW")
    elsewhere["sprint"](
        project,
        start=stored_start(datetime(2026, 3, 2).date(), AUCKLAND),
        end=stored_end(datetime(2026, 3, 27).date(), AUCKLAND),
    )

    url = reverse(
        "arribada-project-overview",
        kwargs={"slug": elsewhere["slug"], "project_id": str(project.id)},
    )
    response = elsewhere["clients"]["owner"].get(url)
    assert response.status_code == 200, response.data

    cycle = response.data["cycles"][0]
    assert str(cycle["start_date"]) == "2026-03-02"
    assert str(cycle["end_date"]) == "2026-03-27"
