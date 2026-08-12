# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The bell, end to end: what it says, whether it can be reached, and whether it
gets there.

Nothing in this app had a single test. Three of the defects pinned below are the
kind that a suite of any size would have caught the day they landed — a subtitle
rendered from a field that is always null, a forwarder that re-sends the same two
hundred rows forever, an escaping call written back to front — and all three
survived a year because the only thing watching them was a log line that said
`sent=200 duplicates=200` and looked healthy.

The forwarding tests never touch the network: `_post` is the seam, and what is
asserted is the shape of what WOULD have been posted. The one thing that is
tested against the real urllib machinery is the refusal to follow a redirect,
because that is a property of the opener rather than of our code.

Everything date-shaped in here is FROZEN and LITERAL, which it was not.

The work item's due date used to be `timezone.now().date() - 7 days` — the same
expression, read off the same clock, as the "is this overdue" the task under
test computes. A test written that way cannot fail: move the product's notion of
today by a day, a timezone or a DST hour and the fixture moves with it, in step,
silently. What it asserted was that subtraction works.

So the due date is a written-down day now, the clock is stopped at a deliberately
awkward instant, and the reminder's sentence is compared against the sentence in
full rather than against three substrings that would survive it being wrong.
"""

import json
from datetime import date

import pytest
from freezegun import freeze_time

from plane.arribada import github_classification_task as triage
from plane.arribada import notify_forward as forward
from plane.arribada import reminder_task as reminders

# Imported for its SIDE EFFECT and never referenced — do not delete it.
#
# `github_classification_warnings` reaches `plane.arribada.views` lazily, which
# pulls in openai and therefore pydantic. `pydantic.v1.types` declares
# `class ConstrainedDate(date, metaclass=ConstrainedNumberMeta)`, and freezegun
# replaces `datetime.date` globally while a clock is frozen — so pydantic
# imported for the FIRST time inside a `freeze_time` block dies on a metaclass
# conflict, in a traceback that names neither this file nor the clock.
#
# Pulling it in here, at collection time, means it is already in `sys.modules`
# before any test freezes anything. Without this line the file passes under
# `pytest plane/arribada/` (some other module imported views first) and fails
# under `pytest plane/arribada/test_notifications.py` — a test that depends on
# what else ran beside it.
from plane.arribada import views  # noqa: F401
from plane.arribada.models import GithubIssue
from plane.db.models import Issue, IssueAssignee, Notification, State

# Sunday 25 October 2026 at 23:30 UTC. Chosen to be awkward in both directions:
# Europe put its clocks back that morning, and at 23:30 UTC a reader in Auckland
# is already halfway through the 26th. Any part of this that quietly means "the
# server's day" rather than "the day on the plan" has a chance to show it here.
NOW = "2026-10-25 23:30:00"

# A week before that, written down rather than computed. This is the day the
# reminder has to say out loud.
DUE = date(2026, 10, 18)


# --- fixtures ---------------------------------------------------------------


def work_item(world, name="Fix the antenna mount", target=DUE, state=None, assign="member"):
    issue = Issue.objects.create(
        name=name,
        project=world["project"],
        workspace=world["workspace"],
        state=state or world["state"],
        target_date=target,
        created_by=world["users"]["owner"],
    )
    if assign:
        IssueAssignee.objects.create(
            issue=issue,
            assignee=world["users"][assign],
            project=world["project"],
            workspace=world["workspace"],
        )
    return issue


@pytest.fixture
def notify_env(monkeypatch):
    monkeypatch.setenv("ARRIBADA_NOTIFY_URL", "https://devices.arribada.org/api/notifications")
    monkeypatch.setenv("ARRIBADA_NOTIFY_SECRET", "shhh")
    monkeypatch.setenv("WEB_URL", "https://plane.arribada.org")


@pytest.fixture
def posts(monkeypatch):
    """Capture every batch the forwarder would have sent."""
    sent = []

    def fake_post(items):
        sent.append(items)
        return {"created": len(items), "duplicates": 0, "unknownRecipients": []}

    monkeypatch.setattr(forward, "_post", fake_post)
    return sent


# --- what the reminder says -------------------------------------------------
#
# The user asked for project · work item · status. What they had was
# "{issue.name} is overdue" as the title AND "<b>{issue.name}</b> is overdue" as
# the body — the same sentence twice, naming neither the project nor the state,
# above a subtitle that rendered as a bare hyphen.


@pytest.mark.django_db
@freeze_time(NOW)
def test_the_reminder_names_the_project_the_work_item_and_the_state(money_project):
    """The sentence in full, against a due date nobody computed.

    Four substrings used to stand in for it, and between them they allowed the
    reminder to name the wrong day — which is the only field in the sentence a
    reader acts on — while every assertion passed. `18 Oct` is the one part of
    this that a timezone can move, so it is the part that is written down.
    """
    progress = State.objects.create(
        name="In progress", project=money_project["project"], workspace=money_project["workspace"],
        group="started", sequence=3,
    )
    work_item(money_project, target=DUE, state=progress)

    reminders.due_date_reminder()

    row = Notification.objects.get(sender="in_app:reminder")
    assert row.title == "Tag · TAG-1 — overdue since 18 Oct (In progress)"
    # And the machine-readable half of the same fact, which the dashboard card
    # and the Zulip line both read.
    assert row.message["target_date"] == "2026-10-18"
    assert row.message["reminder"] == "overdue"


@pytest.mark.django_db
@freeze_time(NOW)
def test_the_reminder_no_longer_says_the_same_thing_twice(money_project):
    """The title and the body were one sentence, rendered one under the other."""
    work_item(money_project)

    reminders.due_date_reminder()

    row = Notification.objects.get(sender="in_app:reminder")
    assert row.message_html.strip() in ("", "<p></p>"), row.message_html


@pytest.mark.django_db
@freeze_time(NOW)
def test_the_reminder_fills_the_subtitle_the_card_reads(money_project):
    """`data.issue` drives the sidebar's second line. It was null, and the card
    interpolated identifier-sequence_id regardless: every reminder wore a hyphen."""
    work_item(money_project)

    reminders.due_date_reminder()
    issue = Notification.objects.get(sender="in_app:reminder").data["issue"]

    assert issue["identifier"] == "TAG"
    assert issue["sequence_id"] == 1
    assert issue["name"] == "Fix the antenna mount"
    assert issue["state_name"] == "Backlog"
    # Deliberately absent: `data.issue.id` means "peek this work item" to Plane's
    # pane, which would hide the fork's own detail panel behind a permission-
    # loaded overlay. `entity_identifier` is what the panel links out with.
    assert "id" not in issue


@pytest.mark.django_db
@freeze_time(NOW)
def test_a_work_item_name_can_never_reach_the_inbox_as_markup(money_project):
    """Stored XSS. `issue.name` is user-editable and went straight into
    `message_html`, which the inbox renders with dangerouslySetInnerHTML."""
    work_item(money_project, name='<img src=x onerror="alert(1)">')

    reminders.due_date_reminder()
    row = Notification.objects.get(sender="in_app:reminder")

    assert "<img" not in row.message_html
    assert "onerror" not in row.message_html


# --- what the GitHub triage warnings say ------------------------------------


def _wiki_doc(project, repo_url):
    from plane.arribada.models import ProjectWikiDoc

    return ProjectWikiDoc.objects.create(project=project, github_repo_urls=[repo_url])


def _captured(workspace, repo="arribada/linkit-v4-core", number=1):
    return GithubIssue.objects.create(
        workspace=workspace,
        repo=repo,
        number=number,
        title=f"issue {number}",
        html_url=f"https://github.com/{repo}/issues/{number}",
    )


@pytest.mark.django_db
def test_a_project_name_can_never_reach_the_inbox_as_markup(money_project):
    """The contested-repo warning joins PROJECT NAMES into `message_html`. A
    project title is typed by whoever creates the project."""
    from plane.db.models import Project

    evil = Project.objects.create(
        name='<img src=x onerror="alert(1)">',
        workspace=money_project["workspace"],
        created_by=money_project["users"]["owner"],
        identifier="EVL",
    )
    repo = "arribada/contested"
    _wiki_doc(money_project["project"], f"https://github.com/{repo}")
    _wiki_doc(evil, f"https://github.com/{repo}")
    _captured(money_project["workspace"], repo=repo)

    triage.github_classification_warnings()

    row = Notification.objects.filter(sender=triage.TRIAGE_SENDER).first()
    assert row is not None, "the contested warning was not raised at all"
    assert "<img" not in row.message_html
    assert 'onerror="' not in row.message_html  # an attribute needs its quote to be one
    assert "&lt;img" in row.message_html, "the name should still be READABLE, just inert"


@pytest.mark.django_db
def test_the_digest_does_not_re_notify_everyone_when_its_count_changes(money_project):
    """The title carries a count and the dedup was keyed on the title, so 7 → 8
    unclassified was a new subject and every active member heard it again — inside
    the twenty hours the window exists to cover.

    The second run is an hour later ACROSS MIDNIGHT, which is the arrangement
    that separates the twenty-hour rolling window this is meant to be from a
    once-a-day one. Both readings suppress a repeat an hour apart on the same
    date; only the rolling one suppresses it at 00:30 the next morning.
    """
    workspace = money_project["workspace"]
    with freeze_time(NOW):
        _captured(workspace, repo="somebody/unclaimed", number=1)
        triage.github_classification_warnings()
        first = Notification.objects.filter(sender=triage.DIGEST_SENDER).count()
        assert first > 0, "no digest was raised at all"

    # One more issue captured an hour later: same complaint, bigger number.
    with freeze_time("2026-10-26 00:30:00"):
        _captured(workspace, repo="somebody/unclaimed", number=2)
        triage.github_classification_warnings()

        assert Notification.objects.filter(sender=triage.DIGEST_SENDER).count() == first


# --- getting it to the dashboard --------------------------------------------


@pytest.mark.django_db
@freeze_time(NOW)
def test_forwarding_delivers_more_than_one_batch(money_project, notify_env, posts):
    """250 unread in one window. The old code took `[:200]` ascending and marked
    nothing, so the newest fifty never went, then aged out of the window for good
    — and because the dashboard had already receipted the other two hundred, the
    run reported `sent=200 duplicates=200` and looked idle.

    The 06:00 reminder and the 06:30 digest land in the same 45 minutes, so this
    is the designed load, not a spike.
    """
    receiver = money_project["users"]["member"]
    Notification.objects.bulk_create(
        [
            Notification(
                workspace=money_project["workspace"],
                project=money_project["project"],
                sender="in_app:reminder",
                receiver=receiver,
                entity_name="issue",
                title=f"reminder {n}",
            )
            for n in range(250)
        ]
    )

    result = forward.forward_notifications()

    assert sum(len(batch) for batch in posts) == 250, result
    # Not one big batch: `notificationIngest.ts` validates items with `.max(200)`
    # and a 201st item 400s the WHOLE payload, so a bigger cap delivers nothing.
    assert all(len(batch) <= forward.MAX_BATCH for batch in posts)
    assert "sent=250" in result


@pytest.mark.django_db
@freeze_time(NOW)
def test_a_failed_batch_stops_rather_than_hammering_a_dashboard_that_is_down(
    money_project, notify_env, monkeypatch
):
    from urllib import error as urlerror

    attempts = []

    def fake_post(items):
        attempts.append(len(items))
        if len(attempts) == 2:
            raise urlerror.URLError("connection refused")
        return {"created": len(items), "duplicates": 0, "unknownRecipients": []}

    monkeypatch.setattr(forward, "_post", fake_post)
    Notification.objects.bulk_create(
        [
            Notification(
                workspace=money_project["workspace"],
                sender="in_app:reminder",
                receiver=money_project["users"]["member"],
                entity_name="issue",
                title=f"reminder {n}",
            )
            for n in range(500)
        ]
    )

    result = forward.forward_notifications()

    assert attempts == [200, 200], attempts
    assert result.startswith("forward failed after 200"), result


def test_escaped_markup_is_not_decoded_back_into_live_markup():
    """`unescape(strip_tags(v))` is an escaping bug wearing a comment: strip_tags
    finds no tag in `&lt;script&gt;`, and unescape then hands one back."""
    assert forward._plain_text("&lt;script&gt;alert(1)&lt;/script&gt;") == "alert(1)"
    assert "<" not in forward._plain_text("&lt;img src=x onerror=alert(1)&gt;")
    # The reason the wrong order was written in the first place still has to hold.
    assert forward._plain_text("<p>Geoff&#x27;s tag</p>") == "Geoff's tag"


def test_the_shared_secret_is_never_sent_over_plain_http(monkeypatch):
    monkeypatch.setenv("ARRIBADA_NOTIFY_URL", "http://devices.arribada.org/api/notifications")
    with pytest.raises(ValueError):
        forward._checked_url()

    monkeypatch.setenv("ARRIBADA_NOTIFY_URL", "https://devices.arribada.org/api/notifications")
    assert forward._checked_url().startswith("https://")

    # Loopback over http is how the dashboard is reached from a compose network.
    monkeypatch.setenv("ARRIBADA_NOTIFY_URL", "http://localhost:3001/api/notifications")
    assert forward._checked_url().startswith("http://localhost")


def test_a_redirect_never_replays_the_secret_at_another_host():
    """urllib's default opener follows a 302 with the headers intact — the shared
    secret included, to whatever host the Location names — and downgrades the POST
    to a GET while it is at it."""
    from urllib import error as urlerror

    handler = forward._RefuseRedirect()
    assert handler.redirect_request(None, None, 302, "Found", {}, "https://evil.example/") is None
    # Returning None is what makes urllib raise rather than replay.
    assert forward._RefuseRedirect in [type(h) for h in forward._opener.handlers] or any(
        isinstance(h, forward._RefuseRedirect) for h in forward._opener.handlers
    )
    assert issubclass(urlerror.HTTPError, Exception)


@pytest.mark.django_db
@freeze_time(NOW)
def test_an_upstream_activity_reads_as_a_sentence_not_half_of_one(money_project, notify_env, posts):
    """Upstream never writes `message_html` and leaves `message` null, so the
    forwarder fell back to `title` — which holds the ACTIVITY FRAGMENT and
    nothing else. The bell showed "updated the state to", trailing space and all.
    The word it was missing sits in `data.issue_activity.new_value`."""
    issue = work_item(money_project, assign=None)
    Notification.objects.create(
        workspace=money_project["workspace"],
        project=money_project["project"],
        sender="in_app:issue-activities",
        receiver=money_project["users"]["member"],
        triggered_by=money_project["users"]["owner"],
        entity_identifier=issue.id,
        entity_name="issue",
        title="updated the state to ",
        data={
            "issue": {
                "id": str(issue.id),
                "name": issue.name,
                "identifier": "TAG",
                "sequence_id": issue.sequence_id,
                "state_name": "In progress",
            },
            "issue_activity": {
                "verb": "updated",
                "field": "state",
                "new_value": "In progress",
                "old_value": "Backlog",
            },
        },
    )

    forward.forward_notifications()

    actor = money_project["users"]["owner"].display_name
    item = posts[0][0]
    assert item["message"] == f"{actor} updated the state to In progress."


@pytest.mark.django_db
def test_the_digest_gets_somewhere_to_go(money_project, notify_env, posts):
    """No project and no work item, so no url could be built — and the dashboard
    falls through to /messages, a page with nothing to do with GitHub."""
    Notification.objects.create(
        workspace=money_project["workspace"],
        project=None,
        sender=triage.DIGEST_SENDER,
        receiver=money_project["users"]["member"],
        entity_name="issue",
        title="7 unclassified GitHub tasks",
    )

    forward.forward_notifications()

    item = posts[0][0]
    assert item["url"] == f"https://plane.arribada.org/{money_project['slug']}/github-triage"


@pytest.mark.django_db
@freeze_time(NOW)
def test_a_forwarded_reminder_still_deep_links_to_its_work_item(money_project, notify_env, posts):
    """`data.issue.id` is absent by design now, so the url has to come from
    `entity_identifier` — the fallback that was already there and never exercised."""
    issue = work_item(money_project)
    reminders.due_date_reminder()

    forward.forward_notifications()

    item = posts[0][0]
    assert item["url"].endswith(f"/issues/{issue.id}")
    assert item["title"] == "TAG-1 · Fix the antenna mount"


@pytest.mark.django_db
@freeze_time(NOW)
def test_every_item_fits_what_the_dashboard_will_accept(money_project, notify_env, posts):
    """The receiving schema caps title at 200 and message at 1000 and rejects the
    item — not the field — when either overflows."""
    work_item(money_project, name="x" * 240)
    reminders.due_date_reminder()

    forward.forward_notifications()

    for batch in posts:
        for item in batch:
            assert len(item["title"]) <= 200
            assert len(item["message"]) <= 1000
            # A null url used to fail validation for the WHOLE batch.
            assert "url" not in item or isinstance(item["url"], str)
            json.dumps(item)
