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
from datetime import date, timedelta

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

# ---------------------------------------------------------------------------
# The agile shape
# ---------------------------------------------------------------------------
#
# The V is plan-driven: one long descent through requirements and design, then a
# climb back through the matching tests. It is the right shape for a board that
# gets fabricated once. It is the wrong shape for a team running fortnights, where
# the unit of work is an increment that is planned, built, tested and shown inside
# one sprint, and the next sprint starts from what that taught you.
#
# So choosing sprints does not merely cut the V into fortnights — it swaps the task
# set. A short inception, then one repeating block per sprint, then a release.

AGILE_SETUP = [
    {
        "key": "ag.vision",
        "phase": "analysis",
        "name": "Product vision and success criteria",
        "role": "project manager",
        "days": 2,
        "after": [],
    },
    {
        "key": "ag.backlog",
        "phase": "analysis",
        "name": "Seed and estimate the backlog",
        "role": "project manager",
        "days": 3,
        "after": ["ag.vision"],
    },
    {
        "key": "ag.dod",
        "phase": "analysis",
        "name": "Definition of done, toolchain and CI",
        "role": "QA / test",
        "days": 2,
        "after": ["ag.vision"],
    },
]

# One architecture spike per component, up front — an iteration cannot discover the
# power budget of a satellite tag halfway through, and pretending otherwise is how
# agile gets blamed for a hardware slip.
AGILE_SPIKES = {
    "hardware": {
        "key": "ag.spike.hardware",
        "name": "Hardware architecture spike",
        "role": "hardware engineer",
        "days": 5,
    },
    "firmware": {
        "key": "ag.spike.firmware",
        "name": "Firmware architecture spike",
        "role": "embedded firmware",
        "days": 4,
    },
    "software": {
        "key": "ag.spike.software",
        "name": "Software architecture spike",
        "role": "software",
        "days": 4,
    },
}

# The increment each component contributes inside a sprint.
AGILE_INCREMENTS = {
    "hardware": {"suffix": "hw", "name": "hardware increment", "role": "hardware engineer"},
    "firmware": {"suffix": "fw", "name": "firmware increment", "role": "embedded firmware"},
    "software": {"suffix": "sw", "name": "software increment", "role": "software"},
}

AGILE_CLOSING = [
    {
        "key": "ag.release",
        "phase": "validation",
        "name": "Release, documentation and handover",
        "role": "project manager",
        "days": 3,
    },
]

# What the picker offers for an agile project: the ceremonies are optional, the
# increment is not — a sprint with no increment is a meeting.
AGILE_CEREMONIES = [
    {"key": "plan", "name": "Sprint planning", "role": "project manager", "days": 1, "optional": False},
    {"key": "test", "name": "Integration and test", "role": "QA / test", "days": 2, "optional": False},
    {"key": "review", "name": "Review and retrospective", "role": "project manager", "days": 1, "optional": True},
]


def agile_catalogue():
    """The agile blocks, in the shape the wizard's picker renders.

    The per-sprint block is described once and repeated at build time, so ticking
    "Review and retrospective" means every sprint gets one — which is the only way
    a ceremony makes sense.
    """
    return {
        "setup": [
            {**task, "optional": False, "phase_label": "Inception"}
            for task in AGILE_SETUP
        ],
        "spikes": [
            {**spec, "phase": "architecture", "phase_label": "Inception", "optional": False, "track": track}
            for track, spec in AGILE_SPIKES.items()
        ],
        "ceremonies": AGILE_CEREMONIES,
        "closing": [{**task, "optional": False, "phase_label": "Release"} for task in AGILE_CLOSING],
    }


def _model_days(value, fallback=5):
    """Working days from something a language model wrote.

    Everything else the model sends is parsed defensively; this one was not, so a
    `days` of "five" or "3-5" raised ValueError out of the builder and turned the
    whole plan step into a 500 — for one bad field in one suggested task.
    """
    try:
        return max(1, min(365, int(value)))
    except (TypeError, ValueError):
        return fallback


def build_agile_tasks(
    tracks,
    *,
    sprint_count,
    sprint_working_days=10,
    ceremonies=None,
    duration_overrides=None,
    role_overrides=None,
    assignees=None,
    extra=None,
    dependency_overrides=None,
):
    """Expand the agile blocks into one task list.

    `sprint_count` repetitions of the per-sprint block, wired so a sprint's work
    waits on its planning and the next sprint waits on this one's review — which is
    what makes the plan iterate rather than run everything at once.
    """
    duration_overrides = duration_overrides or {}
    # {task key: discipline}, replacing the block's own. Applied as a final pass so
    # it reaches the ceremonies and the spikes alike.
    role_overrides = role_overrides or {}
    assignees = assignees or {}
    dependency_overrides = dependency_overrides or {}
    wanted = set(ceremonies if ceremonies is not None else [c["key"] for c in AGILE_CEREMONIES])
    chosen_tracks = [t for t in tracks if t in AGILE_INCREMENTS]
    sprint_count = max(1, min(52, int(sprint_count or 1)))

    def make(key, name, role, days, after, phase):
        return {
            "key": key,
            "name": name,
            "track": "pm",
            "phase": phase,
            "role": role,
            "days": max(1, min(365, int(duration_overrides.get(key, days)))),
            # A redrawn dependency replaces the block's own. Self-links are dropped
            # rather than turned into a one-task cycle.
            "after": [a for a in dependency_overrides.get(key, after) if a != key],
            "assignee_id": assignees.get(key),
        }

    tasks = [make(t["key"], t["name"], t["role"], t["days"], list(t["after"]), t["phase"]) for t in AGILE_SETUP]
    for track in chosen_tracks:
        spec = AGILE_SPIKES[track]
        task = make(spec["key"], spec["name"], spec["role"], spec["days"], ["ag.backlog"], "architecture")
        task["track"] = track
        tasks.append(task)

    ceremony_by_key = {c["key"]: c for c in AGILE_CEREMONIES}
    # What is left for building once the ceremonies have taken their share of the
    # sprint. Never less than a day: a sprint whose ceremonies fill it is a
    # configuration problem, not a reason to emit a zero-length task.
    overhead = sum(ceremony_by_key[k]["days"] for k in wanted if k in ceremony_by_key)
    build_days = max(1, int(sprint_working_days) - overhead)

    previous_review = None
    for index in range(1, sprint_count + 1):
        prefix = f"ag.s{index}"
        entry = [previous_review] if previous_review else [s["key"] for s in AGILE_SPIKES.values() if s["key"] in {t["key"] for t in tasks}]
        entry = [e for e in entry if e]

        plan_key = f"{prefix}.plan"
        if "plan" in wanted:
            tasks.append(make(plan_key, f"Sprint {index} planning", "project manager", 1, entry, "analysis"))
            increment_after = [plan_key]
        else:
            increment_after = entry

        increment_keys = []
        for track in chosen_tracks or ["pm"]:
            spec = AGILE_INCREMENTS.get(track)
            key = f"{prefix}.{spec['suffix']}" if spec else f"{prefix}.work"
            name = f"Sprint {index} — {spec['name']}" if spec else f"Sprint {index} work"
            role = spec["role"] if spec else "project manager"
            task = make(key, name, role, build_days, list(increment_after), "implementation")
            task["track"] = track
            tasks.append(task)
            increment_keys.append(key)

        tail = increment_keys
        if "test" in wanted:
            test_key = f"{prefix}.test"
            tasks.append(
                make(test_key, f"Sprint {index} integration and test", "QA / test", 2, list(increment_keys), "verification")
            )
            tail = [test_key]
        if "review" in wanted:
            review_key = f"{prefix}.review"
            tasks.append(
                make(review_key, f"Sprint {index} review and retrospective", "project manager", 1, list(tail), "validation")
            )
            tail = [review_key]
        previous_review = tail[0] if tail else plan_key

    for task in AGILE_CLOSING:
        tasks.append(
            make(task["key"], task.get("name", key), task["role"], task["days"], [previous_review] if previous_review else [], task["phase"])
        )

    present = {t["key"] for t in tasks}
    for item in extra or []:
        key = str(item.get("key") or "").strip()[:60]
        name = str(item.get("name") or "").strip()[:255]
        if not key or not name or key in present:
            continue
        after = [a for a in item.get("after") or [] if a in present]
        present.add(key)
        tasks.append(
            {
                "key": key,
                "name": name,
                "track": str(item.get("track") or "pm")[:40],
                "phase": str(item.get("phase") or "implementation")[:40],
                "role": str(item.get("role") or "")[:80],
                "days": _model_days(item.get("days")),
                "after": after,
                "assignee_id": assignees.get(key),
                "added": True,
            }
        )

    # One pass at the end rather than at each construction site: a task's discipline
    # is the lead's answer wherever they gave one, whether the task came from the
    # catalogue, a ceremony block or the model.
    for task in tasks:
        moved = role_overrides.get(task["key"])
        if moved:
            task["role"] = moved

    return tasks

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


def next_working_day(day, holidays=None):
    """The first day on or after `day` that anybody works.

    `holidays` is the set of dates nobody works — public holidays, a company
    shutdown, a site closure. Without it this counted Mon-Fri and nothing else, so
    every plan crossing Christmas came out optimistic by exactly the days it did
    not know about: small per week, and it compounds over a quarter.
    """
    holidays = holidays or frozenset()
    # Bounded: a holiday table that somehow covered a whole year must not spin.
    for _ in range(400):
        if day.weekday() < 5 and day not in holidays:
            return day
        day += timedelta(days=1)
    return day


def add_working_days(start, days, holidays=None):
    """Target date of a task that starts on `start` and lasts `days` working days,
    counted inclusively — a one-day task starts and ends the same day."""
    day = next_working_day(start, holidays)
    for _ in range(max(1, int(days)) - 1):
        day = next_working_day(day + timedelta(days=1), holidays)
    return day


def _parse_leave(entries):
    """[(start, end), ...] from the roster's JSON leave list, bad rows dropped."""
    out = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        try:
            start = date.fromisoformat(str(entry.get("start")))
            end = date.fromisoformat(str(entry.get("end") or entry.get("start")))
        except (TypeError, ValueError):
            continue
        if end >= start:
            out.append((start, end))
    return out


def _stretch_for_part_time(days, days_per_week):
    """Elapsed working days for `days` of work at `days_per_week` a week.

    Three days a week means five working days pass for every three worked. The
    scheduler assumed five for everyone, which is how a plan built around a
    part-time engineer comes out nearly twice as fast as it runs.
    """
    try:
        per_week = int(days_per_week or 5)
    except (TypeError, ValueError):
        per_week = 5
    per_week = max(1, min(5, per_week))
    if per_week >= 5:
        return days
    return -(-int(days) * 5 // per_week)


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


def _earliest_free(busy, capacity, earliest, days, holidays=None):
    """First start on or after `earliest` where the role still has a free hand.

    `busy` is that role's list of (start, end) intervals already committed. With a
    capacity of one this is simply "queue behind the last one"; with three it lets
    three tasks of the same discipline run side by side and pushes only the fourth.
    This is the whole reason the proposed end date moves when the lead says how many
    engineers they actually have.
    """
    candidate = next_working_day(earliest, holidays)
    for _ in range(len(busy) + 1):
        end = add_working_days(candidate, days, holidays)
        overlapping = [b for b in busy if b[0] <= end and candidate <= b[1]]
        if len(overlapping) < capacity:
            return candidate, end
        # Wait for the earliest of the blocking tasks to free a slot.
        candidate = next_working_day(min(b[1] for b in overlapping) + timedelta(days=1), holidays)
    end = add_working_days(candidate, days, holidays)
    return candidate, end


def schedule(tasks, start_date, capacity=None, people=None, fixed=None, holidays=None):
    """Give every task a start, a target and — where somebody can be named — an owner.

    `tasks`    [{key, days, after, role, assignee_id?}] — `after` already filtered to
               keys present; `assignee_id` pins the task to one person.
    `people`   [{id, name, roles: [lowercased]}] — who can actually be given work.
    `capacity` {role: how many unnamed hands that discipline has}, default 1. Only
               used for disciplines nobody on the roster covers.

    Scheduling happens against **people**, not disciplines, and a person does one
    thing at a time. That is the whole point: somebody who covers both hardware and
    mechanical is one pair of hands, so their hardware task and their mechanical task
    queue behind each other instead of running side by side — which is exactly what a
    per-discipline count got wrong. Where a discipline has several holders the task
    goes to whoever frees up first, so the work spreads without anyone being cloned.

    `fixed`    {key: (start, target)} — dates a human typed. These are placed exactly
               as given and everything downstream reflows around them, which is the
               point: a hand-set date is a decision, not a suggestion, but the rest of
               the plan still has to hold together around it.

    Returns (by_key, warnings). Dependencies stay hard for everything the scheduler
    places itself: a task never starts before the ones it waits on have finished,
    whoever ends up doing it. A pinned date can break that rule — the person who
    typed it outranks the scheduler — and when it does, it is said out loud.
    """
    capacity = capacity or {}
    people = people or []
    fixed = fixed or {}
    # Dates nobody works. Frozen so the helpers can hold it without copying.
    holidays = frozenset(holidays or ())
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

    # Who covers what. A person appears under every discipline they hold, which is how
    # one calendar comes to constrain several disciplines at once.
    holders = defaultdict(list)
    for person in people:
        for role in person.get("roles") or []:
            holders[str(role).strip().lower()].append(person)
    person_by_id = {p["id"]: p for p in people}

    busy_by_person = defaultdict(list)
    busy_by_role = defaultdict(list)

    # Reserve what is already spoken for BEFORE placing anything.
    #
    # Two things were previously discovered mid-pass, which is too late to act on:
    # a person's leave was not modelled at all, and a pinned date only entered
    # `busy_by_person` when the loop happened to reach that key — so a task placed
    # earlier in the order was free to occupy a slot the pin had already claimed,
    # and the scheduler then warned about a clash it had invented itself.
    for person in people:
        for leave_start, leave_end in _parse_leave(person.get("leave")):
            busy_by_person[person["id"]].append((leave_start, leave_end))

    for key, window in fixed.items():
        task = by_key.get(key)
        if not task:
            continue
        owner_id = task.get("assignee_id")
        if owner_id and owner_id in person_by_id:
            busy_by_person[owner_id].append(window)
        else:
            role_key = (task.get("role") or "").strip().lower()
            holder = holders.get(role_key) or []
            if len(holder) == 1:
                busy_by_person[holder[0]["id"]].append(window)
            else:
                busy_by_role[role_key].append(window)

    placed = {}
    for key in order:
        task = by_key[key]
        earliest = next_working_day(start_date, holidays)
        for pred in preds[key]:
            done = placed.get(pred)
            if done:
                earliest = max(earliest, next_working_day(done["target"] + timedelta(days=1), holidays))

        role = (task.get("role") or "").strip().lower()
        pinned = task.get("assignee_id")
        if pinned and pinned in person_by_id:
            candidates = [person_by_id[pinned]]
        else:
            candidates = holders.get(role, [])

        pin = fixed.get(key)
        if pin:
            # A typed date wins over the schedule. Say so when it contradicts the
            # dependency graph rather than silently drawing an impossible plan.
            start, end = pin
            if start < earliest:
                warnings.append(
                    f'"{task.get("name", key)}" is pinned to {start.isoformat()}, before the work it waits on finishes.'
                )
            owner = candidates[0] if candidates else None
            if owner:
                # This pin's own window is already in the list — it was reserved
                # before the pass so nothing else could take the slot — so compare
                # against everything except itself, or every pin reports a clash
                # with the reservation that exists to protect it.
                clash = any(
                    b != (start, end) and b[0] <= end and start <= b[1]
                    for b in busy_by_person[owner["id"]]
                )
                if clash:
                    warnings.append(
                        f'{owner["name"]} is on two things at once around {start.isoformat()} '
                        f'because "{task.get("name", key)}" is pinned there.'
                    )
                # Already reserved above; adding it twice would make the person
                # look doubly busy to everything scheduled after this point.
                pass
            else:
                pass
            placed[key] = {"start": start, "target": end, "assignee_id": owner["id"] if owner else None}
            continue

        if candidates:
            # Whoever can start soonest. Sorted first so an equal-first tie always
            # resolves the same way and a re-plan does not reshuffle the team.
            best = None
            for person in sorted(
                candidates, key=lambda p: ((p.get("name") or "").lower(), p["id"])
            ):
                # Elapsed days, not worked days: three days a week means five
                # working days pass for every three the person gives you.
                elapsed = _stretch_for_part_time(task["days"], person.get("days_per_week"))
                slot = _earliest_free(busy_by_person[person["id"]], 1, earliest, elapsed, holidays)
                if best is None or slot[0] < best[0]:
                    best = (slot[0], slot[1], person)
            start, end, owner = best
            busy_by_person[owner["id"]].append((start, end))
            placed[key] = {"start": start, "target": end, "assignee_id": owner["id"]}
        else:
            # Nobody on the roster covers this discipline. Fall back to an abstract
            # pool so the plan still holds together; the item records the discipline
            # and finds its owner the day somebody picks it up.
            seats = max(1, int(capacity.get(role, 1) or 1))
            start, end = _earliest_free(busy_by_role[role], seats, earliest, task["days"], holidays)
            busy_by_role[role].append((start, end))
            placed[key] = {"start": start, "target": end, "assignee_id": None}

    return placed, warnings


def compute_float(tasks, placed, project_end=None):
    """How many working days each task can slip before something else moves.

    Delegates to `slack_for_issues`, which does the real backward pass. This
    function used to carry its own, and it was wrong in a way tests built from
    single-chain fixtures could not catch: it bounded a task's latest finish by
    its successors' EARLY starts and never recursed, so `total` came out equal to
    `free` for every task and `critical` degenerated to "hands off immediately".

    On a chain A->B->C beside an independent 40-day task, it called A and B
    critical while their own successor C had 25 days of slack — a critical
    predecessor of a non-critical successor, which cannot happen. The endpoint
    already answered correctly from the other implementation, so the wizard and
    the timeline disagreed about the same project.

    Two implementations of one definition will always drift. There is one now.
    """
    from plane.arribada.scheduling import slack_for_issues

    if not placed:
        return {}

    issues = {key: {"start": v["start"], "target": v["target"]} for key, v in placed.items()}
    # `slack_for_issues` speaks the relation shape the rest of the app stores.
    # `after` is a predecessor list, which is exactly what blocked_by means.
    relations = [
        {"issue_id": task["key"], "related_issue_id": pred, "relation_type": "blocked_by"}
        for task in tasks
        for pred in (task.get("after") or [])
        if pred in placed and task["key"] in placed
    ]
    return slack_for_issues(issues, relations)


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


def sprints_from_agile_keys(placed):
    """Sprint windows read from the task keys, not guessed from the calendar.

    `build_agile_tasks` stamps the sprint into every key it emits (`ag.s3.plan`,
    `ag.s3.review`), so membership is already known exactly. Re-deriving it by
    asking which fixed-length calendar window each start date happens to fall in
    is only equivalent while every sprint takes exactly as long as planned — and
    it never does, because resource contention stretches them. A six-sprint plan
    whose increments serialise spans wide enough that the fixed-length split
    produced twenty windows, so the apply step created twenty cycles named
    "Sprint 1..20" and filed sprint 3's work into "Sprint 7".

    Each sprint's window is the span of the work that actually belongs to it, so
    it widens honestly when the roster forces the increment to take longer.

    Returns ({task key: sprint index}, [sprint dicts]) in index order.
    """
    membership = {}
    for key in placed:
        if not key.startswith("ag.s"):
            continue
        digits = key[4:].split(".", 1)[0]
        if digits.isdigit():
            membership[key] = int(digits)

    if not membership:
        return {}, []

    windows = {}
    for key, index in membership.items():
        dates = placed[key]
        window = windows.get(index)
        if window is None:
            windows[index] = {"start": dates["start"], "end": dates["target"]}
        else:
            window["start"] = min(window["start"], dates["start"])
            window["end"] = max(window["end"], dates["target"])

    sprints = [
        {"index": index, "name": f"Sprint {index}", "start": w["start"], "end": w["end"]}
        for index, w in sorted(windows.items())
    ]
    return membership, sprints


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


def build_tasks(
    selected_keys,
    *,
    field_days=None,
    production_days=None,
    duration_overrides=None,
    role_overrides=None,
    extra=None,
    assignees=None,
    dependency_overrides=None,
):
    """Resolve a selection into the task list the scheduler takes.

    Dependencies pointing at a task that was not selected are dropped rather than
    treated as unmet — unticking "schematic review" should shift the layout earlier,
    not wedge the plan.
    """
    duration_overrides = duration_overrides or {}
    # {task key: discipline} — the lead moving a task onto a different discipline,
    # typically because nobody on this project holds the one the catalogue named.
    # Applied as a final pass so it covers the model-proposed additions too.
    role_overrides = role_overrides or {}
    # {task key: user id} — the lead naming who does this one, overriding "whoever
    # holds the discipline". Optional everywhere.
    assignees = assignees or {}
    # {task key: [predecessor keys]} — a dependency the lead redrew by hand,
    # replacing the catalogue's. Filtered to keys actually present, same as the
    # defaults, so pointing at a task that was unticked simply drops the link.
    dependency_overrides = dependency_overrides or {}
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
                "after": [
                    a
                    for a in (dependency_overrides.get(key, spec.get("after")) or [])
                    if a in present and a != key
                ],
                "assignee_id": assignees.get(key),
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
                "days": _model_days(item.get("days")),
                "after": after,
                "assignee_id": assignees.get(key),
                "added": True,
            }
        )

    # One pass at the end rather than at each construction site: a task's discipline
    # is the lead's answer wherever they gave one, whether the task came from the
    # catalogue, a ceremony block or the model.
    for task in tasks:
        moved = role_overrides.get(task["key"])
        if moved:
            task["role"] = moved

    return tasks
