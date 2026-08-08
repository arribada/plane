# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Forwards Plane's own notifications to the dashboard, so a person has one bell to
# check instead of three. The dashboard is the SSO provider for Plane and the wiki,
# which makes it the only place that knows all three identities are the same person
# — and the join is the email address, so neither side needs the other's user ids.
#
# Dormant unless ARRIBADA_NOTIFY_URL and ARRIBADA_NOTIFY_SECRET are both set.
#
# No "forwarded" flag is kept here on purpose. The task re-sends a rolling window
# every run and the dashboard drops anything it already holds, keyed by the Plane
# notification id. That is crash-safe in a way a flag is not: a flag written before
# a failed POST loses the notification forever, and one written after can double-send
# anyway. Idempotency on the receiving side costs one query and needs no state.

import json
import os
from datetime import timedelta
from html import unescape
from urllib import error, parse, request

from celery import shared_task
from django.utils import timezone
from django.utils.html import strip_tags

from plane.arribada.task_safety import BASE, HTTP_RETRY_POLICY, task_lock

# How far back each run looks. Comfortably wider than the every-10-minutes cadence so
# a missed tick, a restart or a slow queue still gets picked up next time.
WINDOW_MINUTES = 45
# The dashboard's envelope cap, not a preference: `notificationIngest.ts` validates
# `items` with `.max(200)` and a 201st item 400s the WHOLE payload, so raising this
# does not deliver more — it delivers nothing. More than 200 is sent as more posts.
MAX_BATCH = 200
# A bound on one run, so a backlog cannot turn a ten-minute task into an hour of
# HTTP. Twenty thousand notifications in one 45-minute window is not a queue, it is
# an incident, and the log line below says so.
MAX_BATCHES = 100
TIMEOUT_SECONDS = 15

# The two senders that raise a triage warning. Neither carries a work item — that
# is the whole complaint — so neither can be deep-linked the usual way.
TRIAGE_SENDERS = ("in_app:github_triage", "in_app:github_triage_digest")


def is_enabled():
    return bool(os.environ.get("ARRIBADA_NOTIFY_URL") and os.environ.get("ARRIBADA_NOTIFY_SECRET"))


def _plain_text(value):
    """Flatten Plane's stored HTML into the sentence a person would read."""
    if not isinstance(value, str) or not value.strip():
        return ""
    # Unescape FIRST, then strip. The other order is what this used to do and it
    # is an escaping bug wearing a comment: `&lt;script&gt;` survives strip_tags
    # untouched (there is no tag there yet), and unescape then turns it back into
    # live markup on its way to a bell that renders HTML. Decoding before
    # stripping means whatever the entities decode to is a tag by the time
    # strip_tags looks at it.
    return " ".join(strip_tags(unescape(value)).split())


class _RefuseRedirect(request.HTTPRedirectHandler):
    """Follow nothing.

    urllib's default opener replays the request at the Location it is given —
    headers and all, `X-Notify-Secret` included, to whatever host that names —
    and downgrades the POST to a GET on a 301/302/303 while it is at it. So an
    attacker (or a stale reverse-proxy rule) who can answer with a 302 both
    harvests the shared secret and makes the delivery look like it happened.
    A redirect from our own dashboard is a misconfiguration; raising is right.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = request.build_opener(_RefuseRedirect)


def _checked_url():
    url = os.environ["ARRIBADA_NOTIFY_URL"].rstrip("/")
    parts = parse.urlsplit(url)
    if parts.scheme == "https":
        return url
    # http is allowed to the loopback only, which is how the dashboard is reached
    # from a compose network in development. Anywhere else it would put the shared
    # secret on the wire in clear.
    host = (parts.hostname or "").lower()
    if parts.scheme == "http" and host in ("localhost", "127.0.0.1", "::1"):
        return url
    raise ValueError(f"ARRIBADA_NOTIFY_URL must be https (got {parts.scheme or 'no'}://{host or '?'})")


def _post(items):
    url = _checked_url()
    payload = json.dumps({"items": items}).encode("utf-8")
    req = request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Notify-Secret": os.environ["ARRIBADA_NOTIFY_SECRET"],
        },
        method="POST",
    )
    with _opener.open(req, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def _activity_sentence(payload, row):
    """A sentence, out of the pieces upstream leaves lying next to each other.

    Upstream never writes `message_html` for an issue-activity notification — it
    stays the model default `<p></p>` — and `message` is null, so the only thing
    left to fall back on is `title`, which holds the ACTIVITY FRAGMENT and
    nothing else: "updated the state to", trailing space included. The dashboard
    bell showed exactly that, a sentence cut off before the only word that
    mattered. The word is sitting in `data.issue_activity.new_value`.
    """
    activity = payload.get("issue_activity")
    if not isinstance(activity, dict):
        return ""
    fragment = (row.title or "").strip()

    def _value(key):
        raw = activity.get(key)
        # Upstream str()s everything into this dict, so an absent value arrives as
        # the four characters "None" rather than as null.
        if not isinstance(raw, str) or raw in ("", "None"):
            return ""
        return _plain_text(raw) if "<" in raw else " ".join(raw.split())

    value = _value("new_value") or _value("old_value")
    if not value and activity.get("field") == "state":
        issue = payload.get("issue")
        value = (issue or {}).get("state_name") or "" if isinstance(issue, dict) else ""

    actor = ""
    if row.triggered_by:
        actor = (row.triggered_by.display_name or row.triggered_by.first_name or "").strip()

    sentence = " ".join(part for part in (actor, fragment, value) if part)
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence


@shared_task(**BASE, **HTTP_RETRY_POLICY)
def forward_notifications(self):
    """Send the last window's unread Plane notifications to the dashboard.

    `self` is here because HTTP_RETRY_POLICY sets bind=True; beat passes no arguments.
    """
    if not is_enabled():
        return "disabled"

    # Overlapping runs are not a correctness problem — the dashboard dedupes on
    # `external_id` — but they are pure waste: two runs of the same 45-minute window post
    # the same up to 20 000 items twice, at 15 s a request, and the second run's only
    # possible outcome is `duplicates`. After an outage beat delivers every missed
    # ten-minute tick at once, which is exactly when the far side can least afford it.
    with task_lock("forward_notifications", 9 * 60) as held:
        if not held:
            return "another forward_notifications run is already in progress"
        return _forward_notifications()


def _forward_notifications():
    """The forwarding itself, so the task above can hold a lock without re-indenting it."""
    # Imported here, not at module load, so registering the task never touches the
    # model registry before it is ready.
    from plane.db.models import Notification

    since = timezone.now() - timedelta(minutes=WINDOW_MINUTES)
    rows = list(
        Notification.objects.filter(created_at__gte=since, read_at__isnull=True)
        # Bots receive notifications too — a quarter of them here. They have no
        # dashboard account and never will, so forwarding theirs buys nothing but
        # a longer batch and a list of "unknown recipients" on the far side.
        .exclude(receiver__is_bot=True)
        .select_related("receiver", "project", "workspace", "triggered_by")
        # The whole window, chunked below, NOT the first MAX_BATCH of it. The
        # single-slice version starved: past 200 unread in a window every run
        # re-sent the same oldest 200 — already receipted, so `duplicates=200`,
        # which reads exactly like healthy idling — and the newest never went at
        # all, then fell out of the window and were lost. The 06:00 reminder and
        # the 06:30 digest land in the same 45 minutes, so the threshold is
        # reachable by design rather than by accident.
        .order_by("created_at")[: MAX_BATCH * MAX_BATCHES]
    )
    if not rows:
        return "nothing to forward"

    web_url = (os.environ.get("WEB_URL") or "").rstrip("/")
    items = []
    for row in rows:
        email = (row.receiver.email or "").strip() if row.receiver else ""
        if not email:
            continue

        # Where the readable text actually lives, checked against production rather
        # than assumed. Three fields look like the body and two of them are traps:
        # `message_stripped` is declared on the model and written by nothing, and
        # `message` holds a dict of template parameters ({'reminder': 'overdue',
        # 'target_date': ...}), not a sentence. The rendered sentence is in
        # `message_html`, so that is what a person needs to read.
        payload = row.data if isinstance(row.data, dict) else {}
        issue = payload.get("issue") if isinstance(payload.get("issue"), dict) else {}
        identifier = issue.get("identifier")
        sequence = issue.get("sequence_id")
        issue_name = (issue.get("name") or "").strip()

        # Plane's own issue-activity notifier fills `data.issue`; the reminder and
        # triage tasks in this app leave it null and put a usable string in `title`.
        # Both shapes reach here, so both have to work.
        ref = f"{identifier}-{sequence}" if identifier and sequence is not None else ""
        title = " · ".join(part for part in (ref, issue_name) if part) or (row.title or "Plane")

        body = _plain_text(row.message_html)
        if not body and isinstance(row.message, str):
            body = row.message.strip()
        if not body:
            body = _activity_sentence(payload, row)
        if not body:
            body = (row.title or "").strip()

        item = {
            "source": "plane",
            "email": email,
            "title": title[:200],
            "message": body[:1000],
            # The Plane notification id — what the dashboard dedupes on, and why
            # re-sending the same window every run is harmless.
            "external_id": str(row.id),
            "kind": row.entity_name or None,
        }

        # A deep link back to the work item, when one can be built. The key is
        # OMITTED rather than sent as null: the receiving schema treats an absent
        # url as "none given", and a null used to fail validation for the whole
        # batch — which silently dropped every notification alongside it.
        slug = row.workspace.slug if row.workspace else None
        issue_id = issue.get("id") or (str(row.entity_identifier) if row.entity_identifier else None)
        if web_url and issue_id and row.project_id and row.workspace_id and slug:
            item["url"] = f"{web_url}/{slug}/projects/{row.project_id}/issues/{issue_id}"
        elif web_url and slug and row.sender in TRIAGE_SENDERS:
            # The triage warnings have no project and no work item, so the branch
            # above can never fire for them — and a notification with no url makes
            # the dashboard fall through to /messages, a page that has nothing to
            # do with GitHub. The queue itself is the thing to open: it is where
            # the complaint is answered.
            item["url"] = f"{web_url}/{slug}/github-triage"

        items.append(item)

    if not items:
        return "nothing to forward"

    # One POST per MAX_BATCH. The cap is the receiver's, not ours — see MAX_BATCH.
    sent = 0
    created = 0
    duplicates = 0
    unknown = 0
    for start in range(0, len(items), MAX_BATCH):
        chunk = items[start : start + MAX_BATCH]
        try:
            result = _post(chunk)
        except (error.URLError, error.HTTPError, TimeoutError, ValueError) as exc:
            # Never raise: the next run re-sends the same window, so a dashboard that is
            # down for twenty minutes costs nothing but a delay. Stopping rather than
            # continuing, because the usual reason a chunk fails is that the far side is
            # down — and firing the rest at it would only lengthen the outage.
            return f"forward failed after {sent}: {exc}"
        sent += len(chunk)
        created += result.get("created") or 0
        duplicates += result.get("duplicates") or 0
        unknown += len(result.get("unknownRecipients") or [])

    # `pending` is the tell this log line was missing. `sent=200 duplicates=200`
    # was indistinguishable from a healthy idle run, which is how the starvation
    # went unnoticed; a non-zero pending says out loud that the window held more
    # than one run is willing to carry.
    pending = "" if len(rows) < MAX_BATCH * MAX_BATCHES else f" pending=truncated-at-{MAX_BATCH * MAX_BATCHES}"
    return f"sent={sent} created={created} duplicates={duplicates} unknown={unknown}{pending}"
