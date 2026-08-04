# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Every task the schedule names must exist by the time beat says its name.

Celery's `autodiscover_tasks()` only scans `<app>/tasks.py`. Upstream registers
its tasks through `CELERY_IMPORTS`; this fork imports one module per task by hand
in `ArribadaConfig.ready`. Either way a task left out fails in the quietest way
there is: beat sends the name on schedule, no worker has ever heard of it, and
neither side raises. No import breaks, `manage.py check` stays clean, and the
only symptom is a table that never fills.

It has happened twice. `cycle_scope_snapshot` was scheduled and never registered,
so `arribada_cycle_scope_snapshot` held zero rows after beat had fired it. And
`github_plane_sync` spent a day unregistered because a helper was inserted
between `@shared_task` and its `def`, which decorated the helper instead.

Two different mistakes, one symptom, and nothing else in the suite catches
either — because this is not a question about any one module, it is a question
about the schedule and the registry agreeing.

No database: both are in memory.
"""

import inspect

from plane.celery import app as celery_app


def _registry():
    """The task registry as a worker has it at boot.

    A worker calls `import_default_modules()` on start, which is what pulls in
    everything named in `CELERY_IMPORTS`. Reading the registry without it would
    only prove that upstream registers its tasks by a different mechanism than
    this fork does, and would report ten upstream tasks as missing when they are
    not. Anything still absent after this really is absent from a running worker.
    """
    celery_app.loader.import_default_modules()
    # Touching `.tasks` finalizes the app, which is what triggers autodiscovery.
    return celery_app.tasks


def _scheduled_task_names():
    return {entry["task"] for entry in celery_app.conf.beat_schedule.values()}


def test_every_scheduled_task_is_registered():
    """The whole point. A name beat can send that celery cannot answer is a job
    that silently never runs."""
    registered = _registry()
    missing = sorted(name for name in _scheduled_task_names() if name not in registered)
    assert missing == [], f"scheduled but never registered: {missing}"


def test_the_forks_own_tasks_are_in_the_schedule():
    """A guard on the guard above: an empty or fork-less schedule would satisfy
    it while nothing this fork adds ever ran."""
    ours = {name for name in _scheduled_task_names() if name.startswith("plane.arribada.")}
    assert len(ours) >= 5, f"the fork's tasks have gone missing from the schedule: {sorted(ours)}"


def test_every_scheduled_task_takes_the_arguments_beat_gives_it():
    """Registered is not quite enough. `@shared_task` sitting on the wrong
    function still registers a name — it just resolves to the wrong body, which
    is exactly how `github_plane_sync` broke. Beat passes nothing, so a scheduled
    task that requires an argument is a scheduled task that raises every time."""
    registry = _registry()
    for name in sorted(_scheduled_task_names()):
        task = registry.get(name)
        assert task is not None, name
        required = [
            parameter.name
            for parameter in inspect.signature(task.run).parameters.values()
            if parameter.default is inspect.Parameter.empty
            and parameter.kind
            in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        ]
        assert required == [], f"{name} needs arguments beat will never pass: {required}"
