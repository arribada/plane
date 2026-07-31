# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# The generic shape of a device project, and the scheduler that turns a selection
# of it into dates.
#
# Every project this team runs is some mix of three tracks — electronics, firmware,
# software — plus, often, a field deployment and a production run. Each track follows
# the same V: requirements and architecture down the left, implementation at the
# bottom, then verification back up the right, each test stage answering the design
# stage across from it. That structure is what is encoded here, once, so a new project
# starts from a plan instead of an empty backlog.
#
# Deliberately pure: dicts and dates in, dicts and dates out, no ORM and no network.
# The endpoints do the I/O, and the model — when one is configured — only ever adjusts
# the *content* (durations, extra tasks). Dates are always computed here, because a
# language model asked for eighty consistent dates will get some of them wrong and
# nobody will notice which.

from collections import defaultdict, deque
from datetime import timedelta

# ---------------------------------------------------------------------------
# Tracks
# ---------------------------------------------------------------------------

TRACKS = [
    {
        "key": "hardware",
        "label": "Hardware",
        "hint": "Electronics: analysis, schematics, PCB layout, enclosure, bring-up and validation.",
    },
    {
        "key": "firmware",
        "label": "Firmware",
        "hint": "Embedded: architecture, drivers, application, power profiling, HIL validation.",
    },
    {
        "key": "software",
        "label": "Software",
        "hint": "Backend, app and data: architecture, API, UI, ingestion, tests, deployment.",
    },
    {
        "key": "field",
        "label": "Field mission",
        "hint": "A deployment: planning, permits, preparation, the trip itself, recovery and report.",
    },
    {
        "key": "production",
        "label": "Production",
        "hint": "Making more than one: production files, test jig, pilot run, series, QA.",
    },
]

# Where a task sits on the V. Used only for grouping in the UI, so a lead can see at a
# glance that they have kept the design work and dropped the verification.
PHASES = [
    ("analysis", "Requirements & analysis"),
    ("architecture", "Architecture & design"),
    ("implementation", "Implementation"),
    ("verification", "Verification"),
    ("validation", "Validation & release"),
    ("operations", "Field & production"),
]

# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
#
# key          stable id, also what the UI ticks
# track        which component this belongs to
# phase        position on the V (see PHASES)
# role         the discipline that does it — this is what turns into an assignee
# days         working days, a starting point the lead can override
# after        keys that must finish first; any pointing at a track that was not
#              selected are dropped when the plan is built
# optional     unticked by default — real work, but not every project needs it

TASKS = [
    # --- project management: always present, they are what the reviews hang off ----
    {
        "key": "pm.kickoff",
        "track": "pm",
        "phase": "analysis",
        "name": "Project kickoff and scope",
        "role": "project manager",
        "days": 2,
        "after": [],
    },
    {
        "key": "pm.requirements",
        "track": "pm",
        "phase": "analysis",
        "name": "System requirements and specification",
        "role": "project manager",
        "days": 5,
        "after": ["pm.kickoff"],
    },
    {
        "key": "pm.pdr",
        "track": "pm",
        "phase": "architecture",
        "name": "Preliminary design review (PDR)",
        "role": "reviewer",
        "days": 1,
        "after": ["hw.architecture", "fw.architecture", "sw.architecture"],
    },
    {
        "key": "pm.cdr",
        "track": "pm",
        "phase": "architecture",
        "name": "Critical design review (CDR)",
        "role": "reviewer",
        "days": 1,
        "after": ["hw.layout_review", "fw.hal", "sw.api"],
        "optional": True,
    },
    {
        "key": "pm.closure",
        "track": "pm",
        "phase": "validation",
        "name": "Project closure and lessons learned",
        "role": "project manager",
        "days": 2,
        "after": [
            "hw.dfm",
            "fw.release",
            "sw.docs",
            "sw.deploy",
            "field.report",
            "prod.ship",
            "prod.qa",
        ],
    },
    # --- hardware -----------------------------------------------------------------
    {
        "key": "hw.analysis",
        "track": "hardware",
        "phase": "analysis",
        "name": "Hardware requirements, power and size budget",
        "role": "hardware engineer",
        "days": 5,
        "after": ["pm.requirements"],
    },
    {
        "key": "hw.architecture",
        "track": "hardware",
        "phase": "architecture",
        "name": "Hardware architecture and block diagram",
        "role": "hardware engineer",
        "days": 4,
        "after": ["hw.analysis"],
    },
    {
        "key": "hw.components",
        "track": "hardware",
        "phase": "architecture",
        "name": "Component selection and first BOM",
        "role": "hardware engineer",
        "days": 3,
        "after": ["hw.architecture"],
    },
    {
        "key": "hw.schematic",
        "track": "hardware",
        "phase": "implementation",
        "name": "Schematic design",
        "role": "hardware engineer",
        "days": 8,
        "after": ["hw.components", "pm.pdr"],
    },
    {
        "key": "hw.schematic_review",
        "track": "hardware",
        "phase": "verification",
        "name": "Schematic review",
        "role": "reviewer",
        "days": 2,
        "after": ["hw.schematic"],
    },
    {
        "key": "hw.layout",
        "track": "hardware",
        "phase": "implementation",
        "name": "PCB layout and routing",
        "role": "hardware engineer",
        "days": 10,
        "after": ["hw.schematic_review"],
    },
    {
        "key": "hw.layout_review",
        "track": "hardware",
        "phase": "verification",
        "name": "Layout and DRC review",
        "role": "reviewer",
        "days": 2,
        "after": ["hw.layout"],
    },
    {
        "key": "hw.mechanical",
        "track": "hardware",
        "phase": "implementation",
        "name": "Enclosure and mechanical integration",
        "role": "mechanical",
        "days": 8,
        "after": ["hw.architecture"],
        "optional": True,
    },
    {
        "key": "hw.fab",
        "track": "hardware",
        "phase": "implementation",
        "name": "Prototype fabrication and assembly",
        "role": "hardware engineer",
        "days": 15,
        "after": ["hw.layout_review"],
    },
    {
        "key": "hw.bringup",
        "track": "hardware",
        "phase": "verification",
        "name": "Board bring-up and power-on test",
        "role": "hardware engineer",
        "days": 5,
        "after": ["hw.fab"],
    },
    {
        "key": "hw.validation",
        "track": "hardware",
        "phase": "validation",
        "name": "Electrical validation against requirements",
        "role": "QA / test",
        "days": 5,
        "after": ["hw.bringup"],
    },
    {
        "key": "hw.environmental",
        "track": "hardware",
        "phase": "validation",
        "name": "Environmental, ingress and drop testing",
        "role": "QA / test",
        "days": 5,
        "after": ["hw.validation", "hw.mechanical"],
        "optional": True,
    },
    {
        "key": "hw.dfm",
        "track": "hardware",
        "phase": "validation",
        "name": "Design for manufacture and production files",
        "role": "hardware engineer",
        "days": 4,
        "after": ["hw.validation"],
    },
    # --- firmware -----------------------------------------------------------------
    {
        "key": "fw.analysis",
        "track": "firmware",
        "phase": "analysis",
        "name": "Firmware requirements analysis",
        "role": "embedded firmware",
        "days": 4,
        "after": ["pm.requirements"],
    },
    {
        "key": "fw.architecture",
        "track": "firmware",
        "phase": "architecture",
        "name": "Firmware architecture, memory map and interfaces",
        "role": "embedded firmware",
        "days": 4,
        "after": ["fw.analysis"],
    },
    {
        "key": "fw.hal",
        "track": "firmware",
        "phase": "implementation",
        "name": "Board support and drivers",
        "role": "embedded firmware",
        "days": 10,
        "after": ["fw.architecture", "pm.pdr"],
    },
    {
        "key": "fw.app",
        "track": "firmware",
        "phase": "implementation",
        "name": "Application logic implementation",
        "role": "embedded firmware",
        "days": 12,
        "after": ["fw.hal"],
    },
    {
        "key": "fw.power",
        "track": "firmware",
        "phase": "validation",
        "name": "Power consumption profiling and optimisation",
        "role": "embedded firmware",
        "days": 5,
        "after": ["fw.app", "hw.bringup"],
    },
    {
        "key": "fw.ota",
        "track": "firmware",
        "phase": "implementation",
        "name": "Bootloader and update process",
        "role": "embedded firmware",
        "days": 5,
        "after": ["fw.app"],
        "optional": True,
    },
    {
        "key": "fw.unit",
        "track": "firmware",
        "phase": "verification",
        "name": "Firmware unit tests",
        "role": "embedded firmware",
        "days": 5,
        "after": ["fw.app"],
    },
    {
        "key": "fw.integration",
        "track": "firmware",
        "phase": "verification",
        "name": "Hardware/firmware integration tests",
        "role": "QA / test",
        "days": 6,
        "after": ["fw.unit", "hw.bringup"],
    },
    {
        "key": "fw.hil",
        "track": "firmware",
        "phase": "validation",
        "name": "Bench and hardware-in-the-loop validation",
        "role": "QA / test",
        "days": 5,
        "after": ["fw.integration"],
    },
    {
        "key": "fw.release",
        "track": "firmware",
        "phase": "validation",
        "name": "Firmware release and documentation",
        "role": "embedded firmware",
        "days": 2,
        "after": ["fw.hil", "fw.power"],
    },
    # --- software -----------------------------------------------------------------
    {
        "key": "sw.analysis",
        "track": "software",
        "phase": "analysis",
        "name": "Software requirements and user stories",
        "role": "software",
        "days": 4,
        "after": ["pm.requirements"],
    },
    {
        "key": "sw.architecture",
        "track": "software",
        "phase": "architecture",
        "name": "Software architecture and data model",
        "role": "software",
        "days": 4,
        "after": ["sw.analysis"],
    },
    {
        "key": "sw.ux",
        "track": "software",
        "phase": "architecture",
        "name": "UI and UX design",
        "role": "designer",
        "days": 6,
        "after": ["sw.analysis"],
        "optional": True,
    },
    {
        "key": "sw.api",
        "track": "software",
        "phase": "implementation",
        "name": "Backend and API implementation",
        "role": "software",
        "days": 12,
        "after": ["sw.architecture", "pm.pdr"],
    },
    {
        "key": "sw.frontend",
        "track": "software",
        "phase": "implementation",
        "name": "Frontend and app implementation",
        "role": "software",
        "days": 12,
        "after": ["sw.architecture", "sw.ux"],
    },
    {
        "key": "sw.ingest",
        "track": "software",
        "phase": "implementation",
        "name": "Device data ingestion and payload decoding",
        "role": "software",
        "days": 6,
        "after": ["sw.architecture", "fw.app"],
        "optional": True,
    },
    {
        "key": "sw.unit",
        "track": "software",
        "phase": "verification",
        "name": "Software unit tests",
        "role": "software",
        "days": 4,
        "after": ["sw.api", "sw.frontend"],
    },
    {
        "key": "sw.integration",
        "track": "software",
        "phase": "verification",
        "name": "Software integration tests",
        "role": "QA / test",
        "days": 4,
        "after": ["sw.unit", "sw.ingest"],
    },
    {
        "key": "sw.e2e",
        "track": "software",
        "phase": "validation",
        "name": "End-to-end and acceptance tests",
        "role": "QA / test",
        "days": 4,
        "after": ["sw.integration"],
    },
    {
        "key": "sw.deploy",
        "track": "software",
        "phase": "validation",
        "name": "Deployment and CI/CD",
        "role": "software",
        "days": 3,
        "after": ["sw.integration"],
    },
    {
        "key": "sw.docs",
        "track": "software",
        "phase": "validation",
        "name": "User documentation",
        "role": "software",
        "days": 3,
        "after": ["sw.e2e"],
        "optional": True,
    },
    # --- field mission ------------------------------------------------------------
    {
        "key": "field.planning",
        "track": "field",
        "phase": "operations",
        "name": "Mission planning and logistics",
        "role": "field ops",
        "days": 5,
        "after": ["pm.requirements"],
    },
    {
        "key": "field.permits",
        "track": "field",
        "phase": "operations",
        "name": "Permits and partner coordination",
        "role": "project manager",
        "days": 10,
        "after": ["field.planning"],
        "optional": True,
    },
    {
        "key": "field.prep",
        "track": "field",
        "phase": "operations",
        "name": "Equipment preparation and pre-deployment checks",
        "role": "field ops",
        "days": 5,
        "after": ["field.planning", "hw.validation", "fw.hil", "sw.e2e"],
    },
    {
        "key": "field.deployment",
        "track": "field",
        "phase": "operations",
        "name": "Field deployment",
        "role": "field ops",
        # Overridden by the mission length the lead gives; this is only the fallback.
        "days": 10,
        "after": ["field.prep", "field.permits"],
        "duration_from": "field_days",
    },
    {
        "key": "field.recovery",
        "track": "field",
        "phase": "operations",
        "name": "Recovery and data collection",
        "role": "field ops",
        "days": 3,
        "after": ["field.deployment"],
        "optional": True,
    },
    {
        "key": "field.report",
        "track": "field",
        "phase": "operations",
        "name": "Post-mission analysis and report",
        "role": "data / science",
        "days": 5,
        "after": ["field.deployment", "field.recovery"],
    },
    # --- production ---------------------------------------------------------------
    {
        "key": "prod.readiness",
        "track": "production",
        "phase": "operations",
        "name": "Production readiness review",
        "role": "hardware engineer",
        "days": 3,
        "after": ["hw.dfm", "fw.release"],
    },
    {
        "key": "prod.jig",
        "track": "production",
        "phase": "operations",
        "name": "Test jig and production test procedure",
        "role": "QA / test",
        "days": 8,
        "after": ["prod.readiness"],
    },
    {
        "key": "prod.pilot",
        "track": "production",
        "phase": "operations",
        "name": "Pilot run",
        "role": "hardware engineer",
        "days": 10,
        "after": ["prod.jig"],
    },
    {
        "key": "prod.series",
        "track": "production",
        "phase": "operations",
        "name": "Series production",
        "role": "hardware engineer",
        "days": 20,
        "after": ["prod.pilot"],
        "duration_from": "production_days",
    },
    {
        "key": "prod.qa",
        "track": "production",
        "phase": "operations",
        "name": "Incoming inspection and QA",
        "role": "QA / test",
        "days": 5,
        "after": ["prod.series"],
    },
    {
        "key": "prod.ship",
        "track": "production",
        "phase": "operations",
        "name": "Packing and shipping",
        "role": "project manager",
        "days": 3,
        "after": ["prod.qa"],
        "optional": True,
    },
]

TASK_BY_KEY = {t["key"]: t for t in TASKS}

# Tracks that pull in the shared project-management tasks. "pm" is not offered as a
# choice: a project with no kickoff and no review is not a project.
ALWAYS_TRACK = "pm"


def catalogue():
    """The whole catalogue, grouped the way the wizard renders it."""
    phase_labels = dict(PHASES)
    always = {
        "key": ALWAYS_TRACK,
        "label": "Project management",
        "hint": "Kickoff, reviews, closure. Always included.",
    }
    tracks = []
    for track in [always] + TRACKS:
        tasks = [t for t in TASKS if t["track"] == track["key"]]
        tracks.append(
            {
                **track,
                "tasks": [
                    {
                        "key": t["key"],
                        "name": t["name"],
                        "phase": t["phase"],
                        "phase_label": phase_labels.get(t["phase"], t["phase"]),
                        "role": t["role"],
                        "days": t["days"],
                        "optional": bool(t.get("optional")),
                        "after": list(t.get("after") or []),
                    }
                    for t in tasks
                ],
            }
        )
    return {"tracks": tracks, "phases": [{"key": k, "label": v} for k, v in PHASES]}


def default_selection(tracks):
    """The keys a lead starts with for a given set of tracks: everything but the
    optional extras, which are real work but not every project's work."""
    chosen = set(tracks) | {ALWAYS_TRACK}
    return [t["key"] for t in TASKS if t["track"] in chosen and not t.get("optional")]


# ---------------------------------------------------------------------------
# Working-day arithmetic
# ---------------------------------------------------------------------------


def next_working_day(day):
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def add_working_days(start, days):
    """Target date of a task that starts on `start` and lasts `days` working days,
    counted inclusively — a one-day task starts and ends the same day."""
    day = next_working_day(start)
    for _ in range(max(1, int(days)) - 1):
        day = next_working_day(day + timedelta(days=1))
    return day


# ---------------------------------------------------------------------------
# The scheduler
# ---------------------------------------------------------------------------


def _topo(keys, edges):
    """Kahn order over (pred, succ). Anything left in a cycle comes back separately
    rather than silently vanishing from the plan."""
    indeg = {k: 0 for k in keys}
    adj = defaultdict(list)
    for pred, succ in edges:
        if pred in indeg and succ in indeg:
            adj[pred].append(succ)
            indeg[succ] += 1
    queue = deque(sorted(k for k in keys if indeg[k] == 0))
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in sorted(adj[node]):
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return order, [k for k in keys if k not in set(order)]


def _earliest_free(busy, capacity, earliest, days):
    """First start on or after `earliest` where the role still has a free hand.

    `busy` is that role's list of (start, end) intervals already committed. With a
    capacity of one this is simply "queue behind the last one"; with three it lets
    three tasks of the same discipline run side by side and pushes only the fourth.
    This is the whole reason the proposed end date moves when the lead says how many
    engineers they actually have.
    """
    candidate = next_working_day(earliest)
    for _ in range(len(busy) + 1):
        end = add_working_days(candidate, days)
        overlapping = [b for b in busy if b[0] <= end and candidate <= b[1]]
        if len(overlapping) < capacity:
            return candidate, end
        # Wait for the earliest of the blocking tasks to free a slot.
        candidate = next_working_day(min(b[1] for b in overlapping) + timedelta(days=1))
    end = add_working_days(candidate, days)
    return candidate, end


def schedule(tasks, start_date, capacity=None):
    """Give every task a start and a target.

    `tasks`   [{key, days, after, role}] — `after` already filtered to keys present.
    `capacity` {role: how many people can work that discipline at once}, default 1.

    Returns (by_key, warnings). Dependencies are hard (a task never starts before the
    ones it waits on have finished); the role capacity is what decides whether two
    independent tasks run side by side or one after the other.
    """
    capacity = capacity or {}
    warnings = []
    keys = [t["key"] for t in tasks]
    by_key = {t["key"]: t for t in tasks}
    edges = [(pred, t["key"]) for t in tasks for pred in t.get("after") or [] if pred in by_key]

    order, cyclic = _topo(keys, edges)
    if cyclic:
        # Never drop work because the graph is knotted: schedule what is ordered, then
        # append the rest, and say so.
        warnings.append(
            f"{len(cyclic)} task(s) form a dependency loop and were scheduled after the rest."
        )
        order = order + sorted(cyclic)

    preds = defaultdict(list)
    for pred, succ in edges:
        preds[succ].append(pred)

    busy_by_role = defaultdict(list)
    placed = {}
    for key in order:
        task = by_key[key]
        earliest = next_working_day(start_date)
        for pred in preds[key]:
            done = placed.get(pred)
            if done:
                earliest = max(earliest, next_working_day(done["target"] + timedelta(days=1)))
        role = (task.get("role") or "").strip().lower()
        seats = max(1, int(capacity.get(role, 1) or 1))
        start, end = _earliest_free(busy_by_role[role], seats, earliest, task["days"])
        placed[key] = {"start": start, "target": end}
        busy_by_role[role].append((start, end))

    return placed, warnings


def split_into_sprints(start_date, end_date, length_days=14, count=None):
    """Cut the plan's window into sprints.

    Either a length (a fortnight by default) or a number of sprints — giving a count
    divides the window instead, so "I want six sprints" produces six.
    """
    if end_date < start_date:
        return []
    total = (end_date - start_date).days + 1
    if count:
        count = max(1, min(52, int(count)))
        length_days = max(1, -(-total // count))
    length_days = max(1, min(90, int(length_days or 14)))

    sprints = []
    cursor = start_date
    index = 1
    while cursor <= end_date and index <= 52:
        finish = min(cursor + timedelta(days=length_days - 1), end_date)
        sprints.append({"index": index, "name": f"Sprint {index}", "start": cursor, "end": finish})
        cursor = finish + timedelta(days=1)
        index += 1
    return sprints


def assign_sprints(placed, sprints):
    """{task key: sprint index} — a task belongs to the sprint its start falls in."""
    if not sprints:
        return {}
    out = {}
    for key, dates in placed.items():
        for sprint in sprints:
            if sprint["start"] <= dates["start"] <= sprint["end"]:
                out[key] = sprint["index"]
                break
        else:
            out[key] = sprints[-1]["index"]
    return out


# ---------------------------------------------------------------------------
# Putting a plan together
# ---------------------------------------------------------------------------


def build_tasks(selected_keys, *, field_days=None, production_days=None, duration_overrides=None, extra=None):
    """Resolve a selection into the task list the scheduler takes.

    Dependencies pointing at a task that was not selected are dropped rather than
    treated as unmet — unticking "schematic review" should shift the layout earlier,
    not wedge the plan.
    """
    duration_overrides = duration_overrides or {}
    chosen = [k for k in selected_keys if k in TASK_BY_KEY]
    present = set(chosen)
    lengths = {"field_days": field_days, "production_days": production_days}

    tasks = []
    for key in chosen:
        spec = TASK_BY_KEY[key]
        days = spec["days"]
        source = spec.get("duration_from")
        if source and lengths.get(source):
            days = lengths[source]
        if key in duration_overrides:
            days = duration_overrides[key]
        tasks.append(
            {
                "key": key,
                "name": spec["name"],
                "track": spec["track"],
                "phase": spec["phase"],
                "role": spec["role"],
                "days": max(1, min(365, int(days))),
                "after": [a for a in spec.get("after") or [] if a in present],
            }
        )

    # Model-proposed additions ride the same rails as the catalogue, including the
    # dependency filter, so a hallucinated predecessor cannot wedge the schedule.
    for item in extra or []:
        key = str(item.get("key") or "").strip()[:60]
        name = str(item.get("name") or "").strip()[:255]
        if not key or not name or key in present:
            continue
        # Resolved before the key joins `present`, so an item cannot depend on itself.
        after = [a for a in item.get("after") or [] if a in present]
        present.add(key)
        tasks.append(
            {
                "key": key,
                "name": name,
                "track": str(item.get("track") or "pm")[:40],
                "phase": str(item.get("phase") or "implementation")[:40],
                "role": str(item.get("role") or "")[:80],
                "days": max(1, min(365, int(item.get("days") or 5))),
                "after": after,
                "added": True,
            }
        )
    return tasks
