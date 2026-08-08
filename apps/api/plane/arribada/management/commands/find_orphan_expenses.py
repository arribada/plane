# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Expense lines a double-approve may have left behind, and nothing can reach.

Approving a purchase request writes a `ProjectExpense` and points the request at
it. That read was taken outside the transaction that did the writing, so two
clicks on Approve were two requests that both saw an empty `expense_id`, both
created a line, and the second overwrote the pointer to the first. The project
then paid twice — and the survivor was unreachable, because reject and delete
both clean up through that single pointer. No screen shows it as anything other
than an ordinary expense, and nothing in the product can remove it.

The handler now locks the request and re-reads it, and `ProcurementRequest.expense`
is a OneToOne, so this cannot happen again. It says nothing about lines already
sitting in a production database, which is what this command is for.

READ ONLY. It prints; it does not write, and it takes no `--apply`. Deleting an
expense line is a decision about money somebody may genuinely owe — a request
approved, its line deleted by hand, and a second raised for the same parts looks
identical from here. A human reads the list and decides.

HOW A CANDIDATE IS RECOGNISED, stated plainly because the match is a heuristic
and not a proof. An approval-written line is a copy of its request: same project,
label, amount, quantity and currency. So a line is reported when it matches a
request on all five, and that request points somewhere else — at another line, or
at nothing at all. A hand-typed line that happens to duplicate an approved
purchase exactly will therefore appear, and it should: two identical lines for one
purchase is worth a human's attention whichever way they got there.

    python manage.py find_orphan_expenses
    python manage.py find_orphan_expenses --project <uuid>
"""

from collections import defaultdict

from django.core.management.base import BaseCommand

from plane.arribada.models import ProcurementRequest, ProjectExpense


class Command(BaseCommand):
    help = "Report expense lines that look like a duplicate of an approved purchase request. Reads only."

    def add_arguments(self, parser):
        parser.add_argument("--project", help="Restrict to one project id.")

    def handle(self, *args, **options):
        requests = ProcurementRequest.objects.filter(status__in=[ProcurementRequest.APPROVED])
        expenses = ProjectExpense.objects.all()
        if options.get("project"):
            requests = requests.filter(project_id=options["project"])
            expenses = expenses.filter(project_id=options["project"])

        # The shape an approval copies. Decimals compare exactly here because both
        # sides came from the same column type and the same write.
        def shape(row):
            return (
                str(row.project_id),
                (row.label or "").strip(),
                row.amount,
                row.quantity,
                (row.currency or "").strip().upper(),
            )

        by_shape = defaultdict(list)
        for row in requests.only("id", "project_id", "label", "amount", "quantity", "currency", "expense_id"):
            by_shape[shape(row)].append(row)
        if not by_shape:
            self.stdout.write("No approved purchase requests. Nothing to compare against.")
            return

        claimed = {str(r.expense_id) for rows in by_shape.values() for r in rows if r.expense_id}

        found = 0
        for row in expenses.only(
            "id", "project_id", "label", "amount", "quantity", "currency", "incurred_on", "planned"
        ).order_by("project_id", "label"):
            if str(row.id) in claimed:
                continue
            matches = by_shape.get(shape(row))
            if not matches:
                continue
            found += 1
            self.stdout.write(
                f"project={row.project_id} expense={row.id} "
                f"{row.label!r} {row.amount} x {row.quantity} {row.currency} "
                f"planned={row.planned} incurred_on={row.incurred_on} "
                f"— matches request(s) {', '.join(str(m.id) for m in matches)}, "
                f"none of which points at this line"
            )

        if not found:
            self.stdout.write(self.style.SUCCESS("No unclaimed lines matching an approved request."))
            return
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                f"{found} line(s) look like a duplicate of an approved purchase request. "
                "Each is either a double-approve this fixes going forward, or a second line somebody "
                "entered on purpose. Nothing has been changed — check them against the supplier's "
                "invoices before removing any."
            )
        )
