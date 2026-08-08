# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Two invariants the money code always assumed and the database never held.

* A work item has ONE discipline. `IssueRole` was unique on `(issue, role)`, so
  several were legal — and the work-item panel read the alphabetically first while
  the budget charged the alphabetically last. Nothing records how a task's days
  split between two disciplines, so plural could never have produced a cost; it
  only ever produced two answers.

* A purchase request produces ONE expense line. Nothing said so, and a double
  click on Approve produced two — the second orphaned beyond the reach of both
  cleanup paths, which filter on the request's single pointer.

Both are made true here before the constraints go on, because a constraint added
over data that violates it fails the deploy rather than the write that caused it.
"""

from django.db import migrations, models
import django.db.models.deletion


def keep_one_discipline(apps, schema_editor):
    """Collapse every multi-discipline work item to a single row.

    Which one survives is a judgement, so it is stated rather than left to the
    ordering: a discipline a HUMAN set beats one the assistant inferred, and among
    equals the most recently touched wins. Both beat "whichever sorted first",
    which is what the old ordering silently meant.
    """
    IssueRole = apps.get_model("arribada", "IssueRole")
    seen = {}
    doomed = []
    # MANUAL before AI, then newest first: the first row seen for an issue is the
    # keeper and every later one is dropped. `source` is a CharField whose values
    # are "manual" and "ai", so ordering on it descending puts manual first without
    # needing a Case/When.
    for row in IssueRole.objects.order_by("issue_id", "-source", "-updated_at").only(
        "id", "issue_id"
    ):
        if row.issue_id in seen:
            doomed.append(row.id)
        else:
            seen[row.issue_id] = row.id
    if doomed:
        # In batches: an instance that has run the assistant over a large backlog can
        # hold thousands, and a single IN list that long is a query planner's worst day.
        for start in range(0, len(doomed), 500):
            IssueRole.objects.filter(id__in=doomed[start : start + 500]).delete()


def unlink_shared_expenses(apps, schema_editor):
    """No two requests may point at one expense line.

    This should not exist in any database — nothing ever wrote the same id twice on
    purpose — but the column is about to become unique, and a migration that assumes
    its own cleanliness is a deploy that fails at 3am instead of a row that fixes
    itself. The LOSER is unlinked, not deleted: the expense is real money and the
    request that keeps it still says where it came from.
    """
    ProcurementRequest = apps.get_model("arribada", "ProcurementRequest")
    seen = set()
    doomed = []
    for row in ProcurementRequest.objects.exclude(expense_id=None).order_by("created_at").only(
        "id", "expense_id"
    ):
        if row.expense_id in seen:
            doomed.append(row.id)
        else:
            seen.add(row.expense_id)
    if doomed:
        ProcurementRequest.objects.filter(id__in=doomed).update(expense=None)


def noop(apps, schema_editor):
    """Backwards: the constraints come off, and neither deletion can be undone.

    Reversible on purpose anyway — a rollback that refuses to run is a rollback
    nobody can use, and what these functions removed was duplicate rows the code
    on either side of this migration cannot read.
    """


class Migration(migrations.Migration):
    dependencies = [("arribada", "0037_procurement_request_parity")]

    operations = [
        migrations.RunPython(keep_one_discipline, noop),
        migrations.RunPython(unlink_shared_expenses, noop),
        migrations.RemoveConstraint(
            model_name="issuerole", name="arribada_issue_role_unique_issue_role"
        ),
        migrations.AddConstraint(
            model_name="issuerole",
            constraint=models.UniqueConstraint(
                fields=("issue",), name="arribada_issue_role_unique_issue"
            ),
        ),
        migrations.AlterField(
            model_name="procurementrequest",
            name="expense",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="procurement_request",
                to="arribada.projectexpense",
            ),
        ),
    ]
