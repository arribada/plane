# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Turning what GitHub says about an issue into what Plane needs to know.

The routing already existed: a repo claimed by exactly one project has its
issues created there rather than in the inbox. What was missing is everything
around the title — the discipline, the person, the sprint, the priority — all of
which GitHub already knew and the sync discarded.

Two rules run through every function here.

Applied ONLY when the work item is first created. A label changing on GitHub
three weeks later must not reach in and overwrite a discipline somebody set by
hand; the standing rule is that an issue a human has touched is theirs.

Silent when unsure. A label that maps to no discipline, an assignee with no
Plane account, a milestone with no matching sprint: each is left unset rather
than guessed at. A wrong discipline is worse than a missing one, because the
missing one is visible on the Overview and the wrong one is not.
"""

import re

# GitHub label -> the discipline vocabulary this fork uses. Substring matches on
# a normalised label, so "area/firmware" and "Firmware :fire:" both land.
LABEL_DISCIPLINE_HINTS = [
    ("firmware", "embedded firmware"),
    ("embedded", "embedded firmware"),
    ("hardware", "hardware engineer"),
    ("pcb", "hardware engineer"),
    ("electronic", "hardware engineer"),
    ("mechanic", "mechanical"),
    ("enclosure", "mechanical"),
    ("cad", "mechanical"),
    ("software", "software"),
    ("backend", "software"),
    ("frontend", "software"),
    ("app", "software"),
    ("test", "qa / test"),
    ("qa", "qa / test"),
    ("field", "field ops"),
    ("deploy", "field ops"),
    ("data", "data / science"),
    ("analysis", "data / science"),
    ("doc", "project manager"),
    ("admin", "project manager"),
]

# GitHub label -> Plane priority. Ordered: the first match wins, so "p0" beats a
# generic "bug" on an issue carrying both.
LABEL_PRIORITY_HINTS = [
    ("p0", "urgent"),
    ("critical", "urgent"),
    ("blocker", "urgent"),
    ("urgent", "urgent"),
    ("p1", "high"),
    ("high", "high"),
    ("bug", "high"),
    ("p2", "medium"),
    ("p3", "low"),
    ("low", "low"),
    ("nice to have", "low"),
]


def _normalise(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def discipline_from_labels(labels, allowed):
    """The discipline a set of GitHub labels implies, if any.

    `allowed` is the project's own vocabulary; a hint that maps to a discipline
    this project does not use is dropped rather than invented, because the
    picker would then offer something nobody on the roster can hold.
    """
    by_key = {_normalise(a): a for a in (allowed or [])}
    for raw in labels or []:
        text = _normalise(raw)
        if not text:
            continue
        # An exact match on the project's own vocabulary beats any hint: a team
        # that labels issues "PCB Production" means their discipline, not ours.
        if text in by_key:
            return by_key[text]
    for raw in labels or []:
        text = _normalise(raw)
        for needle, discipline in LABEL_DISCIPLINE_HINTS:
            if needle in text and _normalise(discipline) in by_key:
                return by_key[_normalise(discipline)]
    return None


def priority_from_labels(labels):
    """Plane's priority from a label, or None to leave it as it is."""
    texts = [_normalise(raw) for raw in (labels or [])]
    for needle, priority in LABEL_PRIORITY_HINTS:
        for text in texts:
            if needle in text:
                return priority
    return None


def member_from_github_assignees(assignees, candidates):
    """The Plane account a GitHub assignee corresponds to, when exactly one does.

    `candidates` is [(user_id, email, display_name)] for people on the project.
    Matched on the local part of the email or the display name against the
    GitHub login, both normalised — "geoffrey" matches geoffrey@arribada.org.

    Silent on anything ambiguous. Two GitHub assignees, or a login that matches
    two accounts, is a decision; putting work on somebody because a fuzzy match
    fired is how people stop trusting their own task list.
    """
    logins = [_normalise(a.get("login")) for a in (assignees or []) if isinstance(a, dict)]
    logins = [x for x in logins if x]
    if len(logins) != 1:
        return None
    login = logins[0]
    hits = []
    for user_id, email, display in candidates or []:
        local = _normalise((email or "").split("@")[0])
        if local and local == login:
            hits.append(user_id)
            continue
        if _normalise(display) == login:
            hits.append(user_id)
    unique = list(dict.fromkeys(hits))
    return unique[0] if len(unique) == 1 else None


def cycle_from_milestone(milestone, cycles):
    """The sprint a GitHub milestone names, matched on the name alone.

    `cycles` is [(cycle_id, name)]. No fuzzy matching: a milestone called
    "v2" landing work in a sprint called "V2 hardware" is the kind of guess
    that is right often enough to be trusted and wrong often enough to hurt.
    """
    target = _normalise(milestone)
    if not target:
        return None
    hits = [cid for cid, name in (cycles or []) if _normalise(name) == target]
    return hits[0] if len(hits) == 1 else None
