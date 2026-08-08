# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""What the project costs, read end to end through the endpoint that answers it.

`ProjectBudgetEndpoint`, `_labour_cost`, `_budget_display` and the real querysets
under `_cost_by_cycle` had no tests at all. Every figure on the Finance page and
every figure in the annex a funder receives comes out of this one handler, and the
only two files that came near it faked what they were meant to pin — which is why
the defects below all sat in green code.

So this file talks to the API. Real work items, real expense rows, a real rate
card, real archiving. Slower, and the only version that could have caught any of
this.

Run explicitly: `python -m pytest plane/arribada/test_budget_endpoint.py`
"""

from datetime import date

import pytest
from django.urls import reverse

from plane.arribada.models import (
    IssueEffort,
    IssueRole,
    ProjectExpense,
    ProjectSchedule,
    WorkspaceCurrencySettings,
    WorkspaceNonWorkingDay,
    WorkspaceRoleRate,
)
from plane.db.models import Issue

# A working week with nothing in the way: Monday 3rd to Friday 7th August 2026.
MONDAY = date(2026, 8, 3)
FRIDAY = date(2026, 8, 7)


def budget(world, caller="member", **params):
    url = reverse(
        "arribada-project-budget",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"][caller].get(url, params)
    assert response.status_code == 200, response.data
    return response.data


def rate(world, role="firmware", hourly=100, hours=7, currency="GBP"):
    return WorkspaceRoleRate.objects.create(
        workspace=world["workspace"],
        role=role,
        hourly_rate=hourly,
        hours_per_day=hours,
        currency=currency,
    )


def work_item(world, name, start=MONDAY, target=FRIDAY, role="firmware", state=None, **kwargs):
    issue = Issue.objects.create(
        name=name,
        project=world["project"],
        workspace=world["workspace"],
        state=state or world["state"],
        start_date=start,
        target_date=target,
        created_by=world["users"]["owner"],
        **kwargs,
    )
    if role:
        IssueRole.objects.create(issue=issue, role=role)
    return issue


def allocate(world, amount=100000, currency="GBP", start=None, target=None):
    row, _ = ProjectSchedule.objects.get_or_create(project=world["project"])
    row.budget_amount = amount
    row.budget_currency = currency
    if start:
        row.start_date = start
    if target:
        row.target_date = target
    row.save()
    return row


# --- archiving a work item must not un-spend the money it cost ---------------
#
# `bgtasks/issue_automation_task.py` archives completed items on its own once a
# project sets `archive_in`, and the labour query used `Issue.issue_objects`,
# which excludes them. Committed labour therefore DECREASED over time: finished —
# actually paid for — work aged off the budget, `remaining` grew back, and the
# funder report understated the project by exactly what it had delivered.
# Expenses are queried by project id and never left, so the two halves drifted
# with nothing on screen to explain it.


def test_an_archived_work_item_keeps_its_cost(money_project):
    """The defect, stated as a before and after in one test.

    Five working days at £100 x 7 hours is £3,500 either way. Archiving is a
    filing decision about a finished thing; it is not a refund.
    """
    rate(money_project)
    issue = work_item(money_project, "Bring up the radio")
    IssueEffort.objects.create(issue=issue, days=5)

    before = budget(money_project)["labour"]["totals"]
    assert before == [{"currency": "GBP", "amount": 3500.0}]

    Issue.objects.filter(id=issue.id).update(archived_at=date(2026, 9, 1))

    after = budget(money_project)["labour"]["totals"]
    assert after == before, (
        "archiving a finished work item removed its cost from the budget. Committed "
        "labour then falls as work completes, and the funder report understates the "
        "project by what it delivered."
    )


def test_an_archived_item_still_counts_toward_its_sprint(money_project):
    """The per-sprint chart reads the same set the total does.

    A sprint row saying "0 items" beside four thousand pounds explains neither
    figure, which is what counting from a different queryset produced.
    """
    # Allocated in the rate card's own currency, so the figure below is the
    # recorded one and not a conversion — this test is about which rows are
    # counted, and a rate in the middle of it would only obscure that.
    allocate(money_project, currency="GBP")
    rate(money_project)
    issue = work_item(money_project, "Field trial")
    IssueEffort.objects.create(issue=issue, days=2)
    Issue.objects.filter(id=issue.id).update(archived_at=date(2026, 9, 1))

    payload = budget(money_project)
    loose = [row for row in payload["by_cycle"]["cycles"] if row["cycle_id"] is None]
    assert loose, "an archived item in no sprint vanished from the sprint breakdown entirely"
    assert loose[0]["items"] == 1
    assert loose[0]["labour"] == 1400.0


def test_a_draft_is_not_money(money_project):
    """A half-typed item nobody has posted. Excluded, unlike an archived one —
    the difference is whether anybody committed to the work."""
    rate(money_project)
    issue = work_item(money_project, "Maybe")
    IssueEffort.objects.create(issue=issue, days=5)
    Issue.objects.filter(id=issue.id).update(is_draft=True)

    assert budget(money_project)["labour"]["totals"] == []


# --- effort, span, and the calendar under the span ---------------------------


def test_a_recorded_effort_beats_the_calendar_span(money_project):
    """"Post the parcel some time this week" is five working days and about an
    hour of work. Charging the span put five person-days against it."""
    rate(money_project)
    issue = work_item(money_project, "Post the parcel")
    IssueEffort.objects.create(issue=issue, days="0.5")

    payload = budget(money_project)
    assert payload["labour"]["totals"] == [{"currency": "GBP", "amount": 350.0}]
    assert payload["labour"]["from_effort"] == 1
    assert payload["labour"]["from_span"] == 0


def test_the_span_fallback_does_not_charge_a_bank_holiday(money_project):
    """The one caller that omitted the holiday set.

    `_working_days_between` takes one and the capacity reading passes it, so the
    same two dates were worth five person-days on the Finance page and four on
    the capacity bar, with neither screen saying which. A closure is not a
    person-day whichever screen is asking.
    """
    rate(money_project)
    work_item(money_project, "Unestimated")  # Mon-Fri, no IssueEffort
    WorkspaceNonWorkingDay.objects.create(
        workspace=money_project["workspace"], date=date(2026, 8, 5), name="Shutdown"
    )

    payload = budget(money_project)
    assert payload["labour"]["from_span"] == 1
    assert payload["labour"]["totals"] == [{"currency": "GBP", "amount": 2800.0}], (
        "the span fallback billed the workspace's own closure as a person-day"
    )


# --- one discipline, one answer ----------------------------------------------


def test_the_panel_and_the_budget_name_the_same_discipline(money_project):
    """`IssueRole` was unique on `(issue, role)`, so an item could hold two — and
    the work-item panel read the alphabetically first while the budget's dict
    comprehension kept the alphabetically last. The two figures never share a
    screen, so nobody could reconcile them.

    The constraint is on `issue` alone now, so the second write is refused and
    there is only ever one answer to give.
    """
    from django.db import IntegrityError, transaction

    rate(money_project, role="antennas", hourly=10)
    rate(money_project, role="firmware", hourly=100)
    issue = work_item(money_project, "Radio bring-up", role="antennas")
    IssueEffort.objects.create(issue=issue, days=1)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueRole.objects.create(issue=issue, role="firmware")

    payload = budget(money_project)
    assert [row["role"] for row in payload["labour"]["by_role"]] == ["antennas"]

    url = reverse(
        "arribada-issue-role",
        kwargs={
            "slug": money_project["slug"],
            "project_id": money_project["project_id"],
            "issue_id": str(issue.id),
        },
    )
    panel = money_project["clients"]["member"].get(url)
    assert panel.status_code == 200
    assert panel.data["role"] == "antennas", (
        "the work item panel and the budget disagree about which discipline this item is"
    )


# --- a budget held in a currency the pair cannot reach ------------------------
#
# `ProjectScheduleEndpoint` grandfathers a stored `budget_currency` outside
# EUR/GBP rather than rewriting somebody's value, so this state is reachable
# through data. Everything then converted INTO a currency `_convert_money`
# cannot produce: `committed` came out 0, `remaining` reported the whole budget
# still available on a fully committed project, and the rhythm chart, the sprint
# breakdown and the funder report were all empty. That is the €793,764 / €0 shape.


@pytest.fixture
def swiss_budget(money_project):
    # The workspace reads in sterling — every rate in this organisation is — so
    # sterling is the basis the totals fall back to when the allocation's own
    # currency cannot be converted into.
    WorkspaceCurrencySettings.objects.create(
        workspace=money_project["workspace"], eur_gbp_rate="0.85", display_currency="GBP"
    )
    allocate(money_project, amount=100000, currency="CHF")
    rate(money_project, currency="GBP")
    issue = work_item(money_project, "Radio")
    IssueEffort.objects.create(issue=issue, days=10)
    return money_project


def test_an_unreachable_allocation_currency_does_not_report_the_cost_as_nothing(swiss_budget):
    payload = budget(swiss_budget)
    allocation = payload["allocation"]
    assert allocation["committed"] == 7000.0, (
        "a budget held outside EUR/GBP reported the entire cost of the project as zero"
    )
    assert allocation["committed_currency"] == "GBP"
    assert allocation["currency"] == "CHF"


def test_an_unreachable_allocation_currency_withholds_what_it_cannot_compare(swiss_budget):
    """Two figures are refused rather than answered wrongly. A sterling total
    subtracted from a franc ceiling is not arithmetic — and answering it said the
    whole budget was still available on a project already committed."""
    allocation = budget(swiss_budget)["allocation"]
    assert allocation["basis_mismatch"] is True
    assert allocation["remaining"] is None
    assert allocation["percent"] is None


def test_an_ordinary_allocation_still_reports_both(money_project):
    """The half of the rule that is easy to lose: withholding on EVERY project
    would satisfy the test above and break the page for everyone."""
    allocate(money_project, amount=10000, currency="GBP")
    rate(money_project)
    issue = work_item(money_project, "Radio")
    IssueEffort.objects.create(issue=issue, days=1)

    allocation = budget(money_project)["allocation"]
    assert allocation["basis_mismatch"] is False
    assert allocation["committed"] == 700.0
    assert allocation["committed_currency"] == "GBP"
    assert allocation["remaining"] == 9300.0
    assert allocation["percent"] == 7


# --- changing the currency is not a pay rise ---------------------------------


def schedule_url(world):
    return reverse(
        "arribada-project-schedule",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )


@pytest.fixture
def lead_client(money_project):
    """Only the lead may rewrite what the project was given to spend."""
    from plane.arribada.models import ProjectTeamMember

    ProjectTeamMember.objects.create(
        project=money_project["project"],
        name="Lead",
        email="lead@arribada.test",
        member=money_project["users"]["lead"],
        is_lead=True,
    )
    WorkspaceCurrencySettings.objects.create(
        workspace=money_project["workspace"], eur_gbp_rate="0.85", display_currency="GBP"
    )
    allocate(money_project, amount=793764, currency="EUR")
    return money_project["clients"]["lead"]


def test_switching_the_currency_converts_the_amount(money_project, lead_client):
    """It used to relabel it. A €793,764 budget became £793,764 — roughly a 17%
    raise chosen from a dropdown, on the ceiling every figure on the Finance page
    is read against, with nothing on screen to say so."""
    response = lead_client.patch(
        schedule_url(money_project), {"budget_currency": "GBP"}, format="json"
    )
    assert response.status_code == 200, response.data
    row = ProjectSchedule.objects.get(project=money_project["project"])
    assert row.budget_currency == "GBP"
    assert float(row.budget_amount) == 674699.4


def test_sending_an_amount_alongside_it_is_taken_at_face_value(money_project, lead_client):
    """The allocation form sends both, and there the number in the box is what the
    human means. Converting on top of it would apply the rate twice."""
    response = lead_client.patch(
        schedule_url(money_project),
        {"budget_currency": "GBP", "budget_amount": 500000},
        format="json",
    )
    assert response.status_code == 200, response.data
    row = ProjectSchedule.objects.get(project=money_project["project"])
    assert (row.budget_currency, float(row.budget_amount)) == ("GBP", 500000.0)


def test_resaving_the_same_currency_leaves_the_amount_alone(money_project, lead_client):
    """The client resends the stored currency with every allocation save. A
    conversion that fired on that would move the budget every time somebody
    opened the panel."""
    lead_client.patch(schedule_url(money_project), {"budget_currency": "EUR"}, format="json")
    row = ProjectSchedule.objects.get(project=money_project["project"])
    assert float(row.budget_amount) == 793764.0


# --- the spend curve ---------------------------------------------------------
#
# Computed on the server now. It used to be built in the chart component from the
# raw expense list, where it summed `total` across currencies, omitted labour
# entirely while labelling its series "Committed" against the full allocation,
# and dropped rows outside the project span without counting them.


def test_the_curve_includes_labour(money_project):
    """The defect that mattered most. Most projects here are almost entirely
    people: £7,000 of work and £150 of parts drew a line at 2% of the ceiling."""
    allocate(money_project, amount=50000, currency="GBP", start=MONDAY, target=date(2026, 12, 31))
    rate(money_project)
    issue = work_item(money_project, "Radio")
    IssueEffort.objects.create(issue=issue, days=10)

    curve = budget(money_project)["curve"]
    assert curve["points"], "the curve has no points on a project carrying £7,000 of work"
    assert curve["points"][-1]["committed"] == 7000.0
    # Labour is never `spent`: it is derived from a plan and has no receipt.
    assert curve["points"][-1]["spent"] == 0.0


def test_the_curve_converts_rather_than_adding_currencies_together(money_project):
    """€100 beside £100 is not 200 of either. The ceiling and the caption are in
    one currency and the series has to be too."""
    WorkspaceCurrencySettings.objects.create(
        workspace=money_project["workspace"], eur_gbp_rate="0.85", display_currency="GBP"
    )
    allocate(money_project, amount=50000, currency="GBP", start=MONDAY, target=date(2026, 12, 31))
    ProjectExpense.objects.create(
        project=money_project["project"], label="Boards", amount=100, currency="GBP",
        planned=False, incurred_on=MONDAY,
    )
    ProjectExpense.objects.create(
        project=money_project["project"], label="Connectors", amount=100, currency="EUR",
        planned=False, incurred_on=MONDAY,
    )

    curve = budget(money_project)["curve"]
    assert curve["currency"] == "GBP"
    assert curve["converted"] is True
    assert curve["points"][-1]["spent"] == 185.0, (
        "the curve added a euro figure to a sterling one without converting it"
    )


def test_the_curve_counts_what_it_cannot_place(money_project):
    """An expense with no date has no position on a time axis, and one outside
    the project's window used to contribute to no point at all and simply leave
    the chart. Both are now reported rather than dropped in silence."""
    allocate(money_project, amount=50000, currency="GBP", start=MONDAY, target=FRIDAY)
    ProjectExpense.objects.create(
        project=money_project["project"], label="Inside", amount=10, currency="GBP",
        planned=False, incurred_on=date(2026, 8, 4),
    )
    ProjectExpense.objects.create(
        project=money_project["project"], label="Before the project", amount=1000, currency="GBP",
        planned=False, incurred_on=date(2026, 1, 5),
    )
    ProjectExpense.objects.create(
        project=money_project["project"], label="No date", amount=50, currency="GBP", planned=False
    )

    curve = budget(money_project)["curve"]
    assert curve["undated_expenses"] == 1
    assert curve["outside_span"] == 1
    assert curve["points"][-1]["spent"] == 1010.0, (
        "money dated outside the project's window left the chart without being counted "
        "anywhere — the axis is widened to hold it instead"
    )


def test_a_project_with_nothing_dated_draws_nothing(money_project):
    curve = budget(money_project)["curve"]
    assert curve["points"] == []
    assert curve["undated_expenses"] == 0


# --- what the endpoint has always claimed and never proved -------------------


def test_a_supplied_item_is_not_charged_as_person_days(money_project):
    """"Hardware production — six weeks, £4,000 to the supplier" was costed as
    thirty person-days of an internal rate ON TOP of the invoice."""
    allocate(money_project, currency="GBP")
    rate(money_project)
    issue = work_item(money_project, "Hardware production")
    IssueEffort.objects.create(issue=issue, days=30)
    ProjectExpense.objects.create(
        project=money_project["project"],
        issue=issue,
        label="Assembly",
        amount=4000,
        currency="GBP",
        planned=False,
        replaces_labour=True,
    )

    payload = budget(money_project)
    assert payload["labour"]["totals"] == []
    assert payload["labour"]["supplied_items"] == 1
    assert payload["allocation"]["committed"] == 4000.0


def test_an_item_with_no_discipline_still_reports_its_days(money_project):
    """The days are known; only the discipline is missing. Dropping the row made
    a project whose items carry no role report an empty panel, which reads as a
    broken feature rather than as a question nobody has answered."""
    rate(money_project)
    issue = work_item(money_project, "Something", role=None)
    IssueEffort.objects.create(issue=issue, days=3)

    payload = budget(money_project)
    assert [(r["role"], r["days"], r["rated"]) for r in payload["labour"]["by_role"]] == [
        ("unassigned", 3.0, False)
    ]
    assert payload["labour"]["unrated_roles"] == ["unassigned"]


def test_a_guest_cannot_read_any_of_it(money_project):
    """Pinned here as well as in test_money_permissions, because this file is
    where somebody adding a field to the payload will be looking."""
    from plane.app.permissions import ROLE
    from plane.db.models import ProjectMember, User, WorkspaceMember
    from rest_framework.test import APIClient

    guest = User.objects.create(email="guest@arribada.test", username="mw-guest", first_name="G")
    WorkspaceMember.objects.create(
        workspace=money_project["workspace"], member=guest, role=ROLE.GUEST.value
    )
    ProjectMember.objects.create(
        project=money_project["project"],
        workspace=money_project["workspace"],
        member=guest,
        role=ROLE.GUEST.value,
    )
    client = APIClient()
    client.force_authenticate(user=guest)
    url = reverse(
        "arribada-project-budget",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )
    assert client.get(url).status_code == 403
