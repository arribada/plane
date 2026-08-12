# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# What the critical path answers when there is no critical path to answer with.
#
# The computation was never the problem — it runs in tens of milliseconds. The
# problem was that it always produced SOMETHING: on a project with no dependency
# links at all it returned one arbitrary row (whichever task happened to be the
# longest), and the chart rang that bar in red with no explanation. A reader
# looking at it can only conclude the feature does nothing.
#
# So these tests pin the two answers that were wrong and the sentence that was
# missing: a dependency-free project has NO critical path and says why, and a
# lone long task never outranks a real chain.

import datetime as dt

import pytest
from django.urls import reverse

from plane.arribada.scheduling import critical_path, critical_path_report, slack_for_issues
from plane.db.models import Issue, IssueRelation

D = dt.date


def _span(start_day, days):
    """A task starting on 2026-08-`start_day` and running `days` calendar days."""
    return {"start": D(2026, 8, start_day), "target": D(2026, 8, start_day + days - 1)}


def _chain_plus_a_loner():
    """A→B→C at five days each, and D on its own at thirty.

    D is the longest single task in the project by a wide margin, and it is
    connected to nothing. The chain is the critical path; D is just a long job.
    """
    issues = {
        "A": _span(3, 5),
        "B": _span(10, 5),
        "C": _span(17, 5),
        "D": {"start": D(2026, 8, 3), "target": D(2026, 9, 1)},
    }
    rels = [
        {"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"},
        {"issue_id": "B", "related_issue_id": "C", "relation_type": "finish_before"},
    ]
    return issues, rels


def test_an_isolated_long_task_does_not_hide_the_chain():
    """The end of the chain used to be `max(order, key=best)` over EVERY node.

    `best[n]` seeds at the node's own duration, so D — thirty days, no links —
    scored 30 against the chain's 15 and won, and the endpoint answered with a
    set of one unconnected id. That is the longest path in the formal sense and
    it is useless on screen: a reader asking for the critical path wants the
    sequence to attack, and this reported a task that is not in any sequence
    while hiding the one that is.
    """
    issues, rels = _chain_plus_a_loner()
    assert critical_path(issues, rels) == {"A", "B", "C"}


def test_a_project_with_no_dependencies_has_no_critical_path():
    """MARLIN: 0 relations across 77 dated items. The normal case here.

    Every task is independent, so there is no chain for one to be on. The old
    walk still answered — with whichever row was longest — and that is the answer
    nobody could make sense of on screen.
    """
    issues = {"A": _span(3, 5), "B": _span(3, 12), "C": _span(10, 2)}
    assert critical_path(issues, []) == set()


def test_float_is_still_reported_without_dependencies_but_nothing_is_critical():
    """The numbers survive; the claim does not.

    With no links the horizon is just the last date anybody typed, so "zero total
    float" degenerates into "ends on the same day as the latest item" — true, and
    nothing to do with a critical chain. B ends last, so it had `critical: True`
    and got a red ring for no reason a reader could follow.
    """
    issues = {"A": _span(3, 5), "B": _span(3, 12), "C": _span(10, 2)}
    slack = slack_for_issues(issues, [])

    assert set(slack) == {"A", "B", "C"}
    assert [s["critical"] for s in slack.values()] == [False, False, False]
    # Still a useful answer: A can slip, B is the one holding the end date.
    assert slack["A"]["total"] > 0
    assert slack["B"]["total"] == 0


def test_the_chain_and_the_float_answer_two_different_questions():
    """And both are still answered, which is why the endpoint returns both.

    D finishes last, so it is what holds the project's end date — zero total
    float, and the float says so. A→B→C is the sequence somebody has to work
    through in order — and the chain says so. Collapsing them into one number is
    what produced a lone red bar and no chain at all.
    """
    issues, rels = _chain_plus_a_loner()
    slack = slack_for_issues(issues, rels)

    assert critical_path(issues, rels) == {"A", "B", "C"}
    assert {i for i, v in slack.items() if v["critical"]} == {"D"}


def test_report_names_a_dependency_free_project():
    issues = {"A": _span(3, 5), "B": _span(3, 12)}
    report = critical_path_report(issues, [])
    assert report["status"] == "no_dependencies"
    assert report["dated_count"] == 2
    assert report["relation_count"] == 0
    assert report["critical_count"] == 0


def test_report_separates_undated_dependencies_from_missing_ones():
    """A link exists, and it cannot be used because one end has no dates.

    Different cause, different fix — date the item rather than link it — and the
    chart looks identical either way, which is the whole reason this enum exists.
    """
    issues = {"A": _span(3, 5), "B": {"start": None, "target": None}}
    rels = [{"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"}]
    report = critical_path_report(issues, rels)

    assert report["status"] == "dependencies_undated"
    assert report["relation_count"] == 1
    assert report["usable_relation_count"] == 0
    assert report["undated_count"] == 1


def test_report_names_a_loop():
    """Two items blocking each other. Kahn drops both, so there is no order to
    walk and the chain is empty — for a reason worth printing."""
    issues = {"A": _span(3, 5), "B": _span(10, 5)}
    rels = [
        {"issue_id": "A", "related_issue_id": "B", "relation_type": "finish_before"},
        {"issue_id": "B", "related_issue_id": "A", "relation_type": "finish_before"},
    ]
    report = critical_path_report(issues, rels)

    assert report["status"] == "cycles_only"
    assert report["cycle_count"] == 2
    assert critical_path(issues, rels) == set()


def test_report_names_an_undated_project():
    report = critical_path_report({"A": {"start": None, "target": None}}, [])
    assert report["status"] == "no_dated_items"
    assert report["dated_count"] == 0
    assert report["undated_count"] == 1


def test_report_is_ok_when_there_is_a_chain():
    issues, rels = _chain_plus_a_loner()
    report = critical_path_report(issues, rels)
    assert report["status"] == "ok"
    assert report["critical_count"] == 3
    assert report["linked_count"] == 3  # D is not linked to anything
    assert report["usable_relation_count"] == 2


def _dated(world, name, start, target):
    return Issue.objects.create(
        name=name,
        project=world["project"],
        workspace=world["workspace"],
        state=world["state"],
        start_date=start,
        target_date=target,
        created_by=world["users"]["owner"],
    )


@pytest.mark.django_db
def test_endpoint_says_why_a_dependency_free_project_has_no_path(money_project):
    """The whole point, end to end. Three dated items, nothing linked.

    Before: `issue_ids` held one id, `slack` marked one row critical, and the
    screen had nothing to say about either. After: both are empty and the
    payload carries the counts a sentence can be built from.
    """
    world = money_project
    _dated(world, "Design", D(2026, 8, 3), D(2026, 8, 7))
    _dated(world, "Build", D(2026, 8, 3), D(2026, 8, 21))
    _dated(world, "Test", D(2026, 8, 10), D(2026, 8, 11))

    url = reverse(
        "arribada-project-critical-path",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert response.data["issue_ids"] == []
    assert all(not v["critical"] for v in response.data["slack"].values())

    diagnostics = response.data["diagnostics"]
    assert diagnostics["status"] == "no_dependencies"
    assert diagnostics["dated_count"] == 3
    assert diagnostics["relation_count"] == 0


@pytest.mark.django_db
def test_endpoint_reports_the_chain_when_one_exists(money_project):
    world = money_project
    first = _dated(world, "Design", D(2026, 8, 3), D(2026, 8, 7))
    second = _dated(world, "Build", D(2026, 8, 10), D(2026, 8, 14))
    # Long, and joined to nothing: it must not be mistaken for the chain.
    _dated(world, "Soak test", D(2026, 8, 3), D(2026, 9, 30))
    IssueRelation.objects.create(
        issue=second,
        related_issue=first,
        relation_type="blocked_by",
        project=world["project"],
        workspace=world["workspace"],
    )

    url = reverse(
        "arribada-project-critical-path",
        kwargs={"slug": world["slug"], "project_id": world["project_id"]},
    )
    response = world["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert response.data["issue_ids"] == sorted([str(first.id), str(second.id)])
    assert response.data["diagnostics"]["status"] == "ok"
    assert response.data["diagnostics"]["linked_count"] == 2


@pytest.mark.django_db
def test_workspace_endpoint_carries_the_same_diagnostics(money_project):
    """The portfolio's toggle reads this one, and it was the surface the
    complaint was made against."""
    world = money_project
    _dated(world, "Design", D(2026, 8, 3), D(2026, 8, 7))

    url = reverse("arribada-workspace-critical-path", kwargs={"slug": world["slug"]})
    response = world["clients"]["member"].get(url)

    assert response.status_code == 200, response.data
    assert response.data["issue_ids"] == []
    assert response.data["diagnostics"]["status"] == "no_dependencies"
