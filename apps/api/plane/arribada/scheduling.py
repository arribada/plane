# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Dependency scheduling over a project's FS/SS relation graph: a forward cascade
# that pushes successors so they never violate a link, and a longest-path critical
# chain. Pure functions on plain dicts so they are trivially testable and hold no
# ORM state; the endpoints do the I/O.

from collections import defaultdict, deque
from datetime import date, timedelta


def _shift(day, days):
    """`day` moved by `days`, clamped to the ends of the representable calendar.

    `date + timedelta` RAISES past `date.max` rather than saturating, and that
    raise is what turned one work item dated 9999-12-31 into a permanent HTTP 500
    on the gantt: an exception, not a slow answer, on every request from then on
    — including the ones that would have shown you the row to fix.

    Clamping is the honest answer at this edge. A task scheduled to finish on the
    last representable day has no successor date; pinning it there says "as late
    as this calendar goes", which is exactly what the data claims. Nothing real
    reaches it — `_parse_date` refuses dates past a fifty-year horizon — so this
    only ever fires on rows planted before that clamp existed.
    """
    try:
        return day + timedelta(days=days)
    except OverflowError:
        return date.max if days > 0 else date.min

# (predecessor, successor, kind) derivation per relation_type.
# FS = finish-to-start (successor starts after predecessor's target).
# SS = start-to-start (successor starts no earlier than predecessor's start).
_EDGE = {
    "finish_before": ("issue", "related", "FS"),
    "finish_after": ("related", "issue", "FS"),
    "blocked_by": ("related", "issue", "FS"),
    "start_before": ("issue", "related", "SS"),
    "start_after": ("related", "issue", "SS"),
}


def build_edges(relations):
    """relations: iterable of {issue_id, related_issue_id, relation_type} ->
    list of (pred_id, succ_id, kind), skipping unknown/self relations."""
    edges = []
    for r in relations:
        spec = _EDGE.get(r["relation_type"])
        if not spec:
            continue
        pred = r["issue_id"] if spec[0] == "issue" else r["related_issue_id"]
        succ = r["related_issue_id"] if spec[1] == "related" else r["issue_id"]
        if pred == succ:
            continue
        edges.append((str(pred), str(succ), spec[2]))
    return edges


def _topo_order(node_ids, edges):
    """Kahn topological order; nodes in cycles are dropped (and returned separately)."""
    indeg = {n: 0 for n in node_ids}
    adj = defaultdict(list)
    for pred, succ, _ in edges:
        if pred in indeg and succ in indeg:
            adj[pred].append(succ)
            indeg[succ] += 1
    q = deque([n for n in node_ids if indeg[n] == 0])
    order = []
    while q:
        n = q.popleft()
        order.append(n)
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                q.append(m)
    # Against a SET, not against `order`. `n not in order` is a linear scan of a
    # list once per node, so finding the cycles cost O(n²) — 7.7 seconds at
    # sixteen thousand nodes against seven milliseconds here. The answer is
    # identical; only the lookup changed.
    placed = set(order)
    in_cycle = [n for n in node_ids if n not in placed]
    return order, in_cycle


def _next_working_day(d):
    """Advance a date to the next Mon–Fri (weekday() 5=Sat, 6=Sun)."""
    while d.weekday() >= 5:
        moved = _shift(d, 1)
        if moved == d:  # the end of the calendar; there is nowhere further to go
            return d
        d = moved
    return d


def _previous_working_day(d):
    """Step a date back to the nearest Mon-Fri at or before it.

    The mirror of `_next_working_day`, and clamped for the same reason: a row
    dated 0001-01-01 was as plantable through the old bulk date fix as one dated
    9999-12-31, and `date - timedelta` raises at that end too.
    """
    while d.weekday() >= 5:
        moved = _shift(d, -1)
        if moved == d:
            return d
        d = moved
    return d


def weekdays_between(start, end):
    """Mon–Fri days in the inclusive range [start, end]; 0 when the range is empty.

    THE calendar primitive. Every "how many working days" answer in the fork is
    built on this one so they cannot drift, and it is arithmetic rather than a
    walk on purpose.

    Walking the calendar a day at a time is what made a single work item dated
    2500 cost a 41-second gantt response, and one dated 9999-12-31 an
    `OverflowError` — `day += timedelta(days=1)` past `date.max` raises, so the
    endpoint answered 500 forever and no amount of retrying could clear it. A
    ceiling would have stopped the hang; it would also have started returning a
    wrong number silently. Counting instead of walking is exact at every distance
    and cannot overflow, so there is nothing left to bound.

    Holidays are NOT considered here — they are per country and per person, and
    the callers that know which subtract them. See `_working_days_between` and
    `_count_working_days` in views.py, which disagree about the floor on purpose.
    """
    if not start or not end or end < start:
        return 0
    days = (end - start).days + 1
    weeks, rest = divmod(days, 7)
    count = weeks * 5
    first = start.weekday()
    for offset in range(rest):
        if (first + offset) % 7 < 5:
            count += 1
    return count


def plus_working_days(day, n):
    """`n` working days after `day`, landing on a Mon–Fri. n >= 0.

    Whole weeks are added at once — the weekday is preserved by construction — so
    only the remainder is stepped, at most four times whatever `n` is.
    """
    day = _next_working_day(day)
    if n <= 0:
        return day
    weeks, rest = divmod(n, 5)
    day = _shift(day, 7 * weeks)
    for _ in range(rest):
        day = _next_working_day(_shift(day, 1))
    return day


def minus_working_days(day, n):
    """`n` working days before `day`, stepping back over weekends. n >= 0.

    Note the asymmetry with `plus_working_days`: `day` itself is NOT normalised
    forward first. A task whose latest finish falls on a Saturday keeps that
    finish; only the steps backwards skip weekends. That is the behaviour the
    float calculation had before this was arithmetic, and changing it would move
    published slack figures.
    """
    if n <= 0:
        return day
    cursor = _previous_working_day(_shift(day, -1))
    weeks, rest = divmod(n - 1, 5)
    cursor = _shift(cursor, -7 * weeks)
    for _ in range(rest):
        cursor = _previous_working_day(_shift(cursor, -1))
    return cursor


def _working_span(start, target):
    """Working days a task occupies, inclusive. One day is one, not zero."""
    if target < start:
        return 1
    return max(1, weekdays_between(start, target))


def _target_after(start, working_days):
    """Where a task starting on `start` finishes after `working_days` of work."""
    return plus_working_days(start, max(1, working_days) - 1)


def cascade(issues, relations, earliest_starts=None):
    """Forward pass. issues: {id: {"start": date|None, "target": date|None}}.
    Returns {id: {"start": date, "target": date}} for issues whose dates MOVED.
    Only pushes later, never earlier; preserves each issue's duration. Weekend-aware:
    a successor never starts on a Sat/Sun (a Friday finish pushes it to Monday).

    `earliest_starts` is {issue_id: date}: a floor this item cannot start before,
    whatever its predecessors say. It exists for deliveries — a task that needs a
    part cannot begin before the part is expected, and for a hardware organisation
    that date moves a deployment further than any person-day does.

    It is a SEPARATE argument rather than a synthetic relation on purpose. A
    delivery is not a predecessor: it has no duration, nothing depends on it in
    turn, and it must not appear in the critical-path walk or in the float
    figures, where it would be read as work somebody has to do. Passing None —
    which every existing caller does — leaves the behaviour exactly as it was."""
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    order, _cycles = _topo_order(list(dated.keys()), edges)

    preds = defaultdict(list)
    for p, s, k in edges:
        preds[s].append((p, k))

    floors = earliest_starts or {}
    cur = {i: {"start": v["start"], "target": v["target"]} for i, v in dated.items()}
    changed = {}
    for node in order:
        constraints = []
        for p, kind in preds[node]:
            if kind == "FS":
                constraints.append(_next_working_day(_shift(cur[p]["target"], 1)))
            else:  # SS
                constraints.append(_next_working_day(cur[p]["start"]))
        # Added BEFORE the empty check: an item waiting only on a delivery has no
        # predecessors at all, and skipping it would be the whole feature not
        # working for the simplest case there is.
        floor = floors.get(node)
        if floor:
            constraints.append(_next_working_day(floor))
        if not constraints:
            continue
        earliest = _next_working_day(max(constraints))
        if earliest > cur[node]["start"]:
            # Working days, not a calendar timedelta. A task that spanned a weekend
            # carried those two days inside its duration; sliding it to a Monday then
            # gave it two fewer working days, and a task that landed on a Thursday
            # could finish on a Saturday. Auto-schedule writes these dates straight
            # to the database, so the shrinkage was permanent and silent.
            span = _working_span(cur[node]["start"], cur[node]["target"])
            cur[node]["start"] = earliest
            cur[node]["target"] = _target_after(earliest, span)
            changed[node] = {"start": cur[node]["start"], "target": cur[node]["target"]}
    return changed


def critical_path(issues, relations):
    """Longest-duration chain through the FS/SS DAG. Returns a set of issue ids."""
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    order, _cycles = _topo_order(list(dated.keys()), edges)
    if not order:
        return set()

    dur = {i: (v["target"] - v["start"]).days + 1 for i, v in dated.items()}
    adj = defaultdict(list)
    for p, s, _ in edges:
        adj[p].append(s)

    # longest path ending at each node (by summed duration), with predecessor trail
    best = {n: dur[n] for n in order}
    prev = {n: None for n in order}
    for n in order:
        for m in adj[n]:
            # m may be inside a cycle (dropped from the topo order); skip those edges
            # rather than KeyError on best[m].
            if m not in best:
                continue
            if best[n] + dur[m] > best[m]:
                best[m] = best[n] + dur[m]
                prev[m] = n
    end = max(order, key=lambda n: best[n])
    path = set()
    while end is not None:
        path.add(end)
        end = prev[end]
    return path


def slack_for_issues(issues, relations):
    """Working days of slack per issue, from the dates already on them.

    `critical_path` answers "which tasks are on the longest chain". That is one bit
    per task. This answers the question a lead actually asks in a review — "how far
    can this slip before it costs us" — and does it for every task, not just the
    chain.

    Two numbers, both in working days:
      free  — slack against the successors alone; spend it and nothing else moves.
      total — slack against the project's own last day; spend it and the delivery
              date holds but everything downstream shifts.

    A task with zero total float IS on the critical path, so this also subsumes the
    boolean — and cannot disagree with it, which two separately-computed answers
    eventually would.

    Float against the dependency graph, not against people: a task with four days
    of graph slack whose owner is busy for those four days cannot really move. That
    is the standard definition and the honest thing to label it as.
    """
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    if not dated:
        return {}

    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    successors = defaultdict(list)
    for pred, succ, _kind in edges:
        successors[pred].append(succ)

    horizon = max(v["target"] for v in dated.values())

    # `weekdays_between`, not a local walk. This was the second unbounded
    # calendar loop in the fork: `horizon` is the last target date on the
    # project, so ONE work item dated 9999-12-31 made every other item's float
    # walk eight thousand years — and then raise `OverflowError` off the end of
    # `date.max`, which the gantt endpoint reported as a permanent 500.
    working_days = weekdays_between

    def last_working_day_before(day):
        return _previous_working_day(_shift(day, -1))

    # Latest each task may finish, walked backwards from the horizon. Memoised with
    # the horizon written first, so a dependency loop terminates instead of
    # recursing forever — the caller already reports the loop separately.
    latest = {}

    def latest_finish(node):
        if node in latest:
            return latest[node]
        latest[node] = horizon
        children = successors.get(node) or []
        if not children:
            return horizon
        bound = horizon
        for child in children:
            if child not in dated:
                continue
            bound = min(bound, last_working_day_before(latest_start(child)))
        latest[node] = bound
        return bound

    def latest_start(node):
        finish = latest_finish(node)
        span = dated[node]
        # Preserve the task's own duration in working days while sliding it right.
        duration = max(1, working_days(span["start"], span["target"]))
        return minus_working_days(finish, duration - 1)

    out = {}
    for node, span in dated.items():
        children = [c for c in (successors.get(node) or []) if c in dated]
        if children:
            earliest_child = min(dated[c]["start"] for c in children)
            free = max(0, working_days(span["target"], last_working_day_before(earliest_child)) - 1)
        else:
            free = max(0, working_days(span["target"], horizon) - 1)

        total = max(0, working_days(span["target"], latest_finish(node)) - 1)
        total = max(free, total)
        out[node] = {"free": free, "total": total, "critical": total == 0}
    return out
