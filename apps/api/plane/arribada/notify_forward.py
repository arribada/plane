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
from urllib import error, request

from celery import shared_task
from django.utils import timezone

# How far back each run looks. Comfortably wider than the every-10-minutes cadence so
# a missed tick, a restart or a slow queue still gets picked up next time.
WINDOW_MINUTES = 45
MAX_BATCH = 200
TIMEOUT_SECONDS = 15


def is_enabled():
    return bool(os.environ.get("ARRIBADA_NOTIFY_URL") and os.environ.get("ARRIBADA_NOTIFY_SECRET"))


def _post(items):
    url = os.environ["ARRIBADA_NOTIFY_URL"].rstrip("/")
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
    with request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


@shared_task
def forward_notifications():
    """Send the last window's unread Plane notifications to the dashboard."""
    if not is_enabled():
        return "disabled"

    # Imported here, not at module load, so registering the task never touches the
    # model registry before it is ready.
    from plane.db.models import Notification

    since = timezone.now() - timedelta(minutes=WINDOW_MINUTES)
    rows = list(
        Notification.objects.filter(created_at__gte=since, read_at__isnull=True)
        .select_related("receiver", "project", "workspace")
        .order_by("created_at")[:MAX_BATCH]
    )
    if not rows:
        return "nothing to forward"

    web_url = (os.environ.get("WEB_URL") or "").rstrip("/")
    items = []
    for row in rows:
        email = (row.receiver.email or "").strip() if row.receiver else ""
        if not email:
            continue
        # Deep link back to the work item the notification is about, when we can
        # build one — a notification you cannot act on is only half a notification.
        url = None
        if web_url and row.project and row.entity_identifier:
            url = f"{web_url}/{row.workspace.slug}/projects/{row.project_id}/issues/{row.entity_identifier}"
        items.append(
            {
                "source": "plane",
                "email": email,
                "title": (row.title or "Plane")[:200],
                "message": (row.message_stripped or "")[:1000],
                "url": url,
                # The Plane notification id — what the dashboard dedupes on, and why
                # re-sending the same window every run is harmless.
                "external_id": str(row.id),
                "kind": row.entity_name or None,
            }
        )

    if not items:
        return "nothing to forward"

    try:
        result = _post(items)
    except (error.URLError, error.HTTPError, TimeoutError, ValueError) as exc:
        # Never raise: the next run re-sends the same window, so a dashboard that is
        # down for twenty minutes costs nothing but a delay.
        return f"forward failed: {exc}"

    return (
        f"sent={len(items)} created={result.get('created')} "
        f"duplicates={result.get('duplicates')} unknown={len(result.get('unknownRecipients') or [])}"
    )
