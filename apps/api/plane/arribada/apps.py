# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class ArribadaConfig(AppConfig):
    name = "plane.arribada"
    label = "arribada"
    verbose_name = "Arribada extensions"

    def ready(self):
        # register the Celery task (autodiscover only scans <app>/tasks.py)
        from . import reminder_task  # noqa: F401
