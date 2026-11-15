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


def edges_with_lag(relations):
    """relations: iterable of {issue_id, related_issue_id, relation_type[, lag]} ->
    list of (pred_id, succ_id, kind, lag), skipping unknown/self relations.

    `lag` is working days the successor must wait beyond what the link itself
    demands, and it is OPTIONAL: a stored `IssueRelation` has no such column, so
    every relation `_project_graph` builds reads as zero and nothing there moves.
    The setup planner's object-form links (`blueprints.parse_link`) are the one
    source that carries one, and the float figures it computes have to honour it
    or a mandatory five-day gap reads as five days of slack.

    A negative lag — a lead, where the successor may start BEFORE the link would
    otherwise allow — is read as zero here. The float pass can only bound a date
    later, so a lead would have to loosen a bound, and treating it as zero
    reports LESS float than there really is, which is the safe side of wrong for
    a figure that says "how far can this slip".
    """
    edges = []
    for r in relations:
        spec = _EDGE.get(r["relation_type"])
        if not spec:
            continue
        pred = r["issue_id"] if spec[0] == "issue" else r["related_issue_id"]
        succ = r["related_issue_id"] if spec[1] == "related" else r["issue_id"]
        if pred == succ:
            continue
        try:
            lag = max(0, int(r.get("lag") or 0))
        except (TypeError, ValueError):
            lag = 0
        edges.append((str(pred), str(succ), spec[2], lag))
    return edges


def build_edges(relations):
    """relations: iterable of {issue_id, related_issue_id, relation_type} ->
    list of (pred_id, succ_id, kind), skipping unknown/self relations."""
    return [(p, s, k) for p, s, k, _lag in edges_with_lag(relations)]


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


def add_working_days(day, count):
    """`count` working days from `day`, forwards or backwards, weekends skipped.

    The signed form of the two above, with the exact semantics of the loop it
    replaces in views.py (`_add_working_days`): `day` itself is never counted or
    normalised, the walk starts at the next (or previous) calendar day, and only
    Mon–Fri days are counted. So a Friday plus one is Monday, a Saturday plus
    zero is that Saturday, and a Monday minus one is the Friday before.

    Arithmetic rather than a walk, for the reason `weekdays_between` gives: the
    loop version took `current += timedelta(days=1)` once per day between here
    and wherever the input pointed, which for a row dated 9999-12-31 is an
    `OverflowError` and for one dated 2500 is a forty-second response. Clamped at
    the ends of the calendar by `_shift`, so no input can raise.
    """
    if count > 0:
        return plus_working_days(_shift(day, 1), count - 1)
    if count < 0:
        return minus_working_days(day, -count)
    return day


def _working_span(start, target):
    """Working days a task occupies, inclusive. One day is one, not zero."""
    if target < start:
        return 1
    return max(1, weekdays_between(start, target))


def _target_after(start, working_days):
    """Where a task starting on `start` finishes after `working_days` of work."""
    return plus_working_days(start, max(1, working_days) - 1)


def cascade(issues, relations, earliest_starts=None, fixed=frozenset()):
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
    which every existing caller does — leaves the behaviour exactly as it was.

    `fixed` is a set of issue ids whose dates are NEVER moved — work that is
    completed or cancelled. A finished task's dates are a record of what
    happened, not a plan, and the reflow used to rewrite them like any other
    row: a bench test done in March, sitting after a predecessor that slipped to
    May, was re-dated to June, and the funder report then said the test had not
    happened yet. A fixed node still acts as a predecessor with its RECORDED
    dates, so whatever waits on it cascades from where it really finished.
    """
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    order, _cycles = _topo_order(list(dated.keys()), edges)

    preds = defaultdict(list)
    for p, s, k in edges:
        preds[s].append((p, k))

    floors = earliest_starts or {}
    pinned = {str(i) for i in (fixed or ())}
    cur = {i: {"start": v["start"], "target": v["target"]} for i, v in dated.items()}
    changed = {}
    for node in order:
        # Checked before the constraints are even gathered: a finished item has
        # nothing to say about whether its predecessors moved. Its own entry in
        # `cur` stays as recorded, which is what its successors read.
        if node in pinned:
            continue
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
    """The longest chain of LINKED work through the FS/SS DAG. A set of issue ids.

    "Longest chain of linked work" is narrower than the textbook longest path,
    and the narrowing is deliberate — it is what makes the answer readable.

    The walk seeds `best[n]` at the task's own duration and used to take the end
    of the chain as `max(order, ...)` over EVERY dated issue. A single
    thirty-day task connected to nothing therefore outscored a three-link chain
    of five-day ones, and the endpoint answered with a set of ONE unconnected id.
    Formally that is the longest path through the network. On screen it is a lone
    red bar where the reader asked which sequence to attack, and it HIDES the
    chain, which is the thing they can actually do something about. So the end of
    the chain is now chosen among nodes that have at least one link.

    Nothing is lost by that. A lone task that finishes last has zero total float,
    and `slack_for_issues` reports it as critical — the two functions answer two
    different questions and the endpoint returns both.

    And on a project with no links at all this returns the empty set rather than
    one arbitrary row. A critical path is a claim about sequencing; with nothing
    sequenced there is no chain to be on, and "no dependencies recorded" is a
    sentence a reader can act on where a single unexplained red bar is not.
    `critical_path_report` supplies the counts that sentence needs. This is the
    normal case in this fork, not a corner: MARLIN had 0 relations across 77
    dated items when it was measured.
    """
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    edges = [(p, s, k) for (p, s, k) in build_edges(relations) if p in dated and s in dated]
    # Nothing is sequenced, so nothing is on a sequence.
    if not edges:
        return set()
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
    # Only a node with a link can end a chain. Every edge here has both ends
    # dated, so `linked` is already restricted to drawable rows; intersecting
    # with `order` drops the ones sitting inside a cycle.
    linked = {p for p, _s, _k in edges} | {s for _p, s, _k in edges}
    ends = [n for n in order if n in linked]
    if not ends:
        return set()
    end = max(ends, key=lambda n: best[n])
    path = set()
    while end is not None:
        path.add(end)
        end = prev[end]
    return path


def critical_path_report(issues, relations):
    """Why the answer is the answer, in counts a screen can turn into a sentence.

    An empty `issue_ids` has at least four different causes — nothing is dated,
    nothing is linked, everything that is linked is in a loop, or the caller
    cannot see the project — and a chart that draws nothing looks identical for
    all of them. Naming the cause is the difference between "there is no critical
    path here, and here is why" and a reader concluding the feature is broken.

    `status` is an enum rather than English: the wording belongs on the screen
    that knows whose screen it is.
    """
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    all_edges = build_edges(relations)
    edges = [(p, s, k) for (p, s, k) in all_edges if p in dated and s in dated]
    linked = {p for p, _s, _k in edges} | {s for _p, s, _k in edges}
    _order, in_cycle = _topo_order(list(dated.keys()), edges)
    ids = critical_path(issues, relations)

    if not dated:
        status = "no_dated_items"
    elif not all_edges:
        status = "no_dependencies"
    elif not edges:
        # Links exist, but every one of them has an end with no dates — so none
        # of them can be drawn or walked. Distinct from "no dependencies", and
        # the fix is different: date the items rather than link them.
        status = "dependencies_undated"
    elif not ids:
        status = "cycles_only"
    else:
        status = "ok"

    return {
        "status": status,
        "dated_count": len(dated),
        "undated_count": max(0, len(issues) - len(dated)),
        # Sequencing links that exist at all, vs the ones both of whose ends are
        # dated. The gap is the count of links the chart cannot use.
        "relation_count": len(all_edges),
        "usable_relation_count": len(edges),
        "linked_count": len(linked),
        "cycle_count": len(in_cycle),
        "critical_count": len(ids),
    }


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

    With ONE exception, and it is the case this fork mostly sees. On a project
    with no sequencing links at all, the horizon is just the last date anybody
    typed, so "zero total float" reduces to "ends on the same day as the latest
    item" — which marked a handful of unrelated rows critical and told the reader
    nothing. The float figures are still true and still reported; the boolean is
    not, because with nothing sequenced there is no chain to be on. Same rule as
    `critical_path`, so the two still cannot disagree.

    Float against the dependency graph, not against people: a task with four days
    of graph slack whose owner is busy for those four days cannot really move. That
    is the standard definition and the honest thing to label it as.

    THE TWO LINK KINDS BOUND DIFFERENT ENDS, and the backward pass has to know
    which. A finish-to-start link bounds the predecessor's FINISH: it must end
    before the successor's latest start. A start-to-start link (`start_before`,
    `start_after`) bounds only the predecessor's START — the successor waits for
    it to begin, not to end — so its latest finish is that start plus its own
    duration, and the days it keeps working after the successor has begun are
    not a slip. The pass used to bound every predecessor's finish as if every
    link were FS, which on "A 1–18 Sep, B start_after A, B 2 Sep–30 Oct" put A
    on the critical path with zero float: A's latest finish was pinned to 1 Sep,
    the day before B's latest start, when the only thing B asks of A is that A
    starts by the 2nd. A can slip a day. It is not critical, and a reader who
    reorganised a sprint around it was moved by a figure that was wrong.

    `free` follows the same rule per edge: for FS it is the gap between this
    finish and the successor's start, for SS the gap between the two starts.
    And both honour a `lag` on the relation (see `edges_with_lag`), the only
    thing the setup planner's "five days after" links carry that a stored
    relation does not.
    """
    dated = {i: v for i, v in issues.items() if v.get("start") and v.get("target")}
    if not dated:
        return {}

    edges = [
        (p, s, k, lag) for (p, s, k, lag) in edges_with_lag(relations) if p in dated and s in dated
    ]
    sequenced = bool(edges)
    successors = defaultdict(list)
    for pred, succ, kind, lag in edges:
        successors[pred].append((succ, kind, lag))

    horizon = max(v["target"] for v in dated.values())

    # `weekdays_between`, not a local walk. This was the second unbounded
    # calendar loop in the fork: `horizon` is the last target date on the
    # project, so ONE work item dated 9999-12-31 made every other item's float
    # walk eight thousand years — and then raise `OverflowError` off the end of
    # `date.max`, which the gantt endpoint reported as a permanent 500.
    working_days = weekdays_between

    def last_working_day_before(day):
        return _previous_working_day(_shift(day, -1))

    def duration(node):
        # The task's own length in working days, preserved while it slides right.
        span = dated[node]
        return max(1, working_days(span["start"], span["target"]))

    # Latest each task may finish, walked backwards from the horizon. Memoised with
    # the horizon written first, so a dependency loop terminates instead of
    # recursing forever — the caller already reports the loop separately.
    latest = {}

    def latest_finish(node):
        if node in latest:
            return latest[node]
        latest[node] = horizon
        bound = horizon
        for child, kind, lag in successors.get(node) or []:
            if child not in dated:
                continue
            # The latest the child may start, less the gap the link insists on.
            child_start = minus_working_days(latest_start(child), lag)
            if kind == "SS":
                # Only this task's START is bound. Its latest finish is that
                # start plus its own duration — and still never past the
                # horizon, which `bound` began at.
                bound = min(bound, _target_after(child_start, duration(node)))
            else:
                bound = min(bound, last_working_day_before(child_start))
        latest[node] = bound
        return bound

    def latest_start(node):
        return minus_working_days(latest_finish(node), duration(node) - 1)

    out = {}
    for node, span in dated.items():
        # The project's last day is a successor of every task's FINISH. For a
        # task with only FS children it is never the tightest term, since each
        # child starts before the horizon — which is why the old code could
        # consult it only for leaves. For a task with an SS child it can be: the
        # child bounds this START, and a long task may be free to start later
        # than it is free to finish. One list, the horizon always in it.
        frees = [working_days(span["target"], horizon) - 1]
        for child, kind, lag in successors.get(node) or []:
            if child not in dated:
                continue
            child_start = minus_working_days(dated[child]["start"], lag)
            if kind == "SS":
                frees.append(working_days(span["start"], child_start) - 1)
            else:
                frees.append(working_days(span["target"], last_working_day_before(child_start)) - 1)
        free = max(0, min(frees))

        total = max(0, working_days(span["target"], latest_finish(node)) - 1)
        total = max(free, total)
        out[node] = {"free": free, "total": total, "critical": sequenced and total == 0}
    return out
