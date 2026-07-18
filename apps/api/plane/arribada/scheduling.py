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


def cascade(issues, relations):
    """Forward pass. issues: {id: {"start": date|None, "target": date|None}}.
    Returns {id: {"start": date, "target": date}} for issues whose dates MOVED.
    Only pushes later, never earlier; preserves each issue's duration."""
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
                constraints.append(cur[p]["target"] + timedelta(days=1))
            else:  # SS
                constraints.append(cur[p]["start"])
        if not constraints:
            continue
        earliest = max(constraints)
        if earliest > cur[node]["start"]:
            duration = cur[node]["target"] - cur[node]["start"]
            cur[node]["start"] = earliest
            cur[node]["target"] = earliest + duration
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
