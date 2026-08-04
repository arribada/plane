# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class ArribadaConfig(AppConfig):
    name = "plane.arribada"
    label = "arribada"
    verbose_name = "Arribada extensions"

    def ready(self):
        # Register the Celery tasks. Autodiscovery only scans <app>/tasks.py, and
        # this fork keeps a module per task, so every one of them has to be named
        # here — a task left out of this list fails in the quietest way there is:
        # beat sends its name on schedule, no worker has ever heard of it, and
        # nothing on either side raises. test_beat_schedule.py compares this list
        # against the schedule so the next omission is caught in CI instead.
        from . import reminder_task  # noqa: F401
        from . import github_classification_task  # noqa: F401
        from . import github_sync_task  # noqa: F401
        from . import notify_forward  # noqa: F401
        from . import scope_snapshot_task  # noqa: F401
