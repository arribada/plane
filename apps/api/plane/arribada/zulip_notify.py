# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Tiny helper to post a message to a project's Zulip channel. Dormant by default:
# if the ARRIBADA_ZULIP_* env vars are unset every function is a no-op, so nothing
# is ever sent until credentials are provided (mirrors the GITHUB_PAT dormancy).

import logging
import os
import re

import requests

logger = logging.getLogger("plane.arribada.zulip")

# chat_url looks like: https://chat.arribada.org/#narrow/stream/23-sea-turtle-tag-gps
_STREAM_ID_RE = re.compile(r"/stream/(\d+)")


def _config():
    """Return (site, bot_email, api_key) if all three are set, else None (=> dormant).

    Prefers the ARRIBADA_ZULIP_* names but falls back to the plain ZULIP_* ones so the
    same dashboard bot credentials can be reused without duplicating them.
    """
    site = os.environ.get("ARRIBADA_ZULIP_SITE") or os.environ.get("ZULIP_SITE")
    email = os.environ.get("ARRIBADA_ZULIP_BOT_EMAIL") or os.environ.get("ZULIP_BOT_EMAIL")
    key = os.environ.get("ARRIBADA_ZULIP_API_KEY") or os.environ.get("ZULIP_API_KEY")
    if site and email and key:
        return site.rstrip("/"), email, key
    return None


def is_enabled():
    """True when Zulip posting is configured — lets callers skip the extra DB work when off."""
    return _config() is not None


def stream_id_from_chat_url(chat_url):
    """Extract the numeric Zulip stream id from a project's narrow chat_url, or None."""
    if not chat_url:
        return None
    match = _STREAM_ID_RE.search(chat_url)
    return int(match.group(1)) if match else None


def post_to_stream(stream_id, topic, content):
    """Best-effort post of `content` to `stream_id` under `topic`. Returns True on HTTP 200.

    Never raises: a chat outage or a bad stream must not break the reminder task.
    """
    cfg = _config()
    if cfg is None or not stream_id:
        return False
    site, email, key = cfg
    try:
        resp = requests.post(
            f"{site}/api/v1/messages",
            auth=(email, key),
            data={"type": "stream", "to": str(stream_id), "topic": topic, "content": content},
            timeout=8,
        )
        if resp.status_code == 200:
            return True
        logger.warning("zulip post failed: %s %s", resp.status_code, resp.text[:200])
        return False
    except requests.RequestException as exc:  # network/timeout — stay best-effort
        logger.warning("zulip post error: %s", exc)
        return False
