# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The open list is only evidence of closure when it is known to be whole.

Closure is detected by ABSENCE: a GitHub issue this workspace records as open
that is missing from a repo's open list is no longer open. That inference is
correct exactly as often as `complete` is, and wrong in the worst possible
direction when it is not — a timeout returning four issues out of forty would
otherwise mark thirty-six work items done on somebody's board.

So these tests are not about pagination. They are about the second return value,
which has no other guard behind it: `_reconcile_closed` is simply never called
for a repo whose fetch came back `complete=False`.
"""

import pytest

from plane.arribada import github_sync_task as sync


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _issue(number, pull=False):
    body = {"number": number, "title": f"issue {number}", "state": "open"}
    if pull:
        body["pull_request"] = {"url": "…"}
    return body


def _patch(monkeypatch, pages):
    """Serve `pages` in order; anything past the end is an empty page."""
    calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append(params.get("page"))
        index = params.get("page", 1) - 1
        page = pages[index] if index < len(pages) else _Response(200, [])
        if isinstance(page, Exception):
            raise page
        return page

    monkeypatch.setattr(sync.requests, "get", fake_get)
    return calls


def test_short_page_is_a_whole_list(monkeypatch):
    _patch(monkeypatch, [_Response(200, [_issue(1), _issue(2)])])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    assert [i["number"] for i in issues] == [1, 2]
    assert complete is True


def test_empty_repo_is_a_whole_list(monkeypatch):
    # The case with the most to reconcile, not the least: a repo whose every open
    # issue has just been closed answers with nothing at all.
    _patch(monkeypatch, [_Response(200, [])])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    assert issues == []
    assert complete is True


def test_network_error_is_not_a_whole_list(monkeypatch):
    _patch(monkeypatch, [_Response(200, [_issue(n) for n in range(100)]), RuntimeError("boom")])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    # The issues it did read are still returned — capture is worth having — but
    # the caller must not read anything into what is missing.
    assert len(issues) == 100
    assert complete is False


def test_http_error_is_not_a_whole_list(monkeypatch):
    # A revoked or rate-limited PAT. Every issue in every repo would look absent.
    _patch(monkeypatch, [_Response(401, {"message": "Bad credentials"})])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    assert issues == []
    assert complete is False


def test_page_cap_is_not_a_whole_list(monkeypatch):
    full = [_Response(200, [_issue(n) for n in range(100)]) for _ in range(6)]
    calls = _patch(monkeypatch, full)
    issues, complete = sync._fetch_open_issues("pat", "arribada/x", max_pages=5)
    assert calls == [1, 2, 3, 4, 5]
    assert len(issues) == 500
    # There is a sixth page and we did not read it, so an issue that is not in
    # the first five is not thereby closed.
    assert complete is False


def test_pull_requests_are_dropped_but_still_paginate(monkeypatch):
    # The issues endpoint returns PRs too. They must not become work items, and
    # they must not shorten a page either: `len(items)` is what decides whether
    # there is another page, and counting only the issues would end pagination
    # early on any repo where PRs outnumber issues — losing open issues and then
    # reading their absence as closure.
    page1 = [_issue(n, pull=(n % 2 == 0)) for n in range(100)]
    calls = _patch(monkeypatch, [_Response(200, page1), _Response(200, [_issue(500)])])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    assert calls == [1, 2]
    assert all("pull_request" not in i for i in issues)
    assert 500 in [i["number"] for i in issues]
    assert complete is True


def test_unexpected_payload_is_not_a_whole_list(monkeypatch):
    # GitHub answering 200 with an object instead of a list is what an error
    # envelope looks like.
    _patch(monkeypatch, [_Response(200, {"message": "Moved permanently"})])
    issues, complete = sync._fetch_open_issues("pat", "arribada/x")
    assert issues == []
    assert complete is False


@pytest.mark.parametrize(
    "status,payload,expected",
    [
        (200, {"number": 7, "state": "closed"}, "closed"),
        (200, {"number": 7, "state": "open"}, "open"),
    ],
)
def test_single_issue_reports_its_state(monkeypatch, status, payload, expected):
    monkeypatch.setattr(sync.requests, "get", lambda *a, **k: _Response(status, payload))
    assert sync._fetch_issue("pat", "arribada/x", 7)["state"] == expected


@pytest.mark.parametrize("status", [401, 403, 404, 410, 500])
def test_single_issue_refuses_to_guess(monkeypatch, status):
    # None is deliberately not "it is gone". A 404 is a deleted, transferred or
    # newly-private issue — and it is also a revoked token and a renamed repo.
    monkeypatch.setattr(sync.requests, "get", lambda *a, **k: _Response(status, {}))
    assert sync._fetch_issue("pat", "arribada/x", 7) is None


def test_single_issue_survives_a_network_error(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(sync.requests, "get", boom)
    assert sync._fetch_issue("pat", "arribada/x", 7) is None
