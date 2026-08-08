# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Record what each running cycle holds, once a day.

The burndown recomputes every past point from the cycle's CURRENT total, so
adding ten items lifts the whole history by ten and the past changes shape
retroactively. A cycle that held 10 items throughout and one that grew from 5 to
20 draw identically — scope creep, the single most useful thing a burndown can
show, is the one thing it hides.

Nothing in the schema remembers what a cycle held on a past day, so the figure has
to be recorded on the day. This writes one small row per running cycle per night.

History before the first run stays wrong and cannot be invented. The chart says
so rather than drawing a line through days it has no figure for.
"""

from celery import shared_task

from plane.arribada.task_safety import BASE, RETRY_POLICY
from plane.db.models import Cycle, Issue
from plane.utils.exception_logger import log_exception


@shared_task(**BASE, **RETRY_POLICY)
def cycle_scope_snapshot(self):
    """One row per running cycle, for today. Idempotent.

    `self` is here because RETRY_POLICY sets `bind=True`; beat still passes no arguments.
    """
    from django.db.models import Count, Q
    from django.utils import timezone

    from plane.arribada.models import CycleScopeSnapshot

    today = timezone.now().date()

    # Running cycles only. A finished one cannot change scope, and an unstarted one
    # has nothing to record — writing rows for either would be noise that makes the
    # table look busier than the facts warrant.
    cycles = Cycle.objects.filter(
        start_date__lte=today, end_date__gte=today, project__archived_at__isnull=True
    ).values_list("id", flat=True)

    written = 0
    for cycle_id in cycles:
        try:
            counts = Issue.issue_objects.filter(issue_cycle__cycle_id=cycle_id).aggregate(
                total=Count("id", distinct=True),
                completed=Count("id", filter=Q(state__group="completed"), distinct=True),
            )
            # update_or_create rather than create: beat can fire twice after a
            # restart, and a retry must correct the day rather than double it.
            CycleScopeSnapshot.objects.update_or_create(
                cycle_id=cycle_id,
                date=today,
                defaults={"total": counts["total"] or 0, "completed": counts["completed"] or 0},
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            # One bad cycle must not cost every other cycle its snapshot — a gap in
            # this series is permanent, because yesterday cannot be recomputed.
            log_exception(exc)

    return {"cycles": len(cycles), "written": written}
