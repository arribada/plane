# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Dependency scheduling over a project's FS/SS relation graph: a forward cascade
# that pushes successors so they never violate a link, and a longest-path critical
# chain. Pure functions on plain dicts so they are trivially testable and hold no
# ORM state; the endpoints do the I/O.

from collections import defaultdict, deque
from datetime import timedelta

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
    in_cycle = [n for n in node_ids if n not in order]
    return order, in_cycle


def _next_working_day(d):
    """Advance a date to the next Mon–Fri (weekday() 5=Sat, 6=Sun)."""
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _working_span(start, target):
    """Working days a task occupies, inclusive. One day is one, not zero."""
    if target < start:
        return 1
    day, count = start, 0
    while day <= target:
        if day.weekday() < 5:
            count += 1
        day += timedelta(days=1)
    return max(1, count)


def _target_after(start, working_days):
    """Where a task starting on `start` finishes after `working_days` of work."""
    day = _next_working_day(start)
    for _ in range(max(1, working_days) - 1):
        day = _next_working_day(day + timedelta(days=1))
    return day


def cascade(issues, relations):
    """Forward pass. issues: {id: {"start": date|None, "target": date|None}}.
    Returns {id: {"start": date, "target": date}} for issues whose dates MOVED.
    Only pushes later, never earlier; preserves each issue's duration. Weekend-aware:
    a successor never starts on a Sat/Sun (a Friday finish pushes it to Monday)."""
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    order, _cycles = _topo_order(list(dated.keys()), edges)

    preds = defaultdict(list)
    for p, s, k in edges:
        preds[s].append((p, k))

    cur = {i: {"start": v["start"], "target": v["target"]} for i, v in dated.items()}
    changed = {}
    for node in order:
        constraints = []
        for p, kind in preds[node]:
            if kind == "FS":
                constraints.append(_next_working_day(cur[p]["target"] + timedelta(days=1)))
            else:  # SS
                constraints.append(_next_working_day(cur[p]["start"]))
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

    def working_days(start, end):
        if end < start:
            return 0
        day, count = start, 0
        while day <= end:
            if day.weekday() < 5:
                count += 1
            day += timedelta(days=1)
        return count

    def last_working_day_before(day):
        cursor = day - timedelta(days=1)
        while cursor.weekday() >= 5:
            cursor -= timedelta(days=1)
        return cursor

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
        cursor, remaining = finish, duration
        while remaining > 1:
            cursor -= timedelta(days=1)
            while cursor.weekday() >= 5:
                cursor -= timedelta(days=1)
            remaining -= 1
        return cursor

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
