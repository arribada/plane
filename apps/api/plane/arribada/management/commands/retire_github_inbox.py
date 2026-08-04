# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Retire the GitHub inbox project, without losing anything anybody decided.

Step four, and the only irreversible part of the triage work — which is why it
is a command you run deliberately, dry by default, and not something a deploy
does on its way past.

Two populations live in GHIN and they must not be treated alike:

- Issues somebody has TOUCHED — dated, parented, assigned. Those are decisions,
  and the standing rule is that an issue a human has handled is theirs. They are
  never deleted here. If any remain, the project is archived rather than removed,
  because deleting it would take them with it.

- Issues nobody has touched. Those are just GitHub's, mirrored. They are
  represented in the GithubIssue table — backfilled from their external_id if
  the sync recorded them before that table existed — and then the work item is
  removed, so the triage page becomes their only home.

Run it dry first. It prints exactly what it would do and writes nothing.
"""

import re

from django.core.management.base import BaseCommand
from django.db import transaction

REPO_FROM_URL = re.compile(r"github\.com[/:]+([^/\s]+/[^/\s?#\"'<>]+)", re.IGNORECASE)
NUMBER_FROM_URL = re.compile(r"/issues/(\d+)")


class Command(BaseCommand):
    help = "Move untouched GitHub inbox items to the triage table and retire the GHIN project."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually write. Without it nothing is changed and the plan is printed.",
        )

    def handle(self, *args, **options):
        from plane.arribada.models import GithubIssue
        from plane.db.models import Issue, IssueAssignee, Project

        apply_changes = bool(options.get("apply"))
        touched_total = untouched_total = backfilled = 0

        for ghin in Project.objects.filter(identifier="GHIN").select_related("workspace"):
            rows = list(Issue.issue_objects.filter(project=ghin))
            touched, untouched = [], []
            for issue in rows:
                # Read from the work itself rather than a flag: a flag has to be
                # set by every path that edits an issue, and the path that
                # forgets is the one that silently loses somebody's afternoon.
                if (
                    issue.start_date
                    or issue.target_date
                    or issue.parent_id
                    or IssueAssignee.objects.filter(issue_id=issue.id, deleted_at__isnull=True).exists()
                ):
                    touched.append(issue)
                else:
                    untouched.append(issue)

            self.stdout.write(
                f"{ghin.workspace.slug}/{ghin.name}: {len(touched)} touched (kept), "
                f"{len(untouched)} untouched (moved to the triage table)"
            )
            touched_total += len(touched)
            untouched_total += len(untouched)

            with transaction.atomic():
                for issue in untouched:
                    body = issue.description_html or ""
                    repo_hit = REPO_FROM_URL.search(body)
                    number_hit = NUMBER_FROM_URL.search(body)
                    if not repo_hit or not number_hit:
                        # Nothing links it back to GitHub, so removing it would
                        # lose it entirely. Added to `touched` — not merely
                        # counted — because that list is what decides whether the
                        # project is archived or deleted, and deleting it would
                        # cascade over the very rows this branch just spared.
                        # Counting without listing was a spare that did nothing.
                        self.stdout.write(f"   ! no GitHub link, kept: {issue.name[:60]}")
                        touched.append(issue)
                        touched_total += 1
                        untouched_total -= 1
                        continue
                    repo = repo_hit.group(1).lower().rstrip("/").removesuffix(".git")
                    number = int(number_hit.group(1))
                    exists = GithubIssue.objects.filter(
                        workspace=ghin.workspace, repo=repo, number=number
                    ).exists()
                    if not exists:
                        backfilled += 1
                        if apply_changes:
                            GithubIssue.objects.create(
                                workspace=ghin.workspace,
                                repo=repo,
                                number=number,
                                title=issue.name[:512],
                                html_url=f"https://github.com/{repo}/issues/{number}",
                            )
                    if apply_changes:
                        issue.delete()

                if touched:
                    self.stdout.write(
                        f"   {len(touched)} item(s) somebody has handled remain, so the project is "
                        "archived rather than deleted — removing it would take them with it."
                    )
                    if apply_changes and not ghin.archived_at:
                        from django.utils import timezone

                        ghin.archived_at = timezone.now()
                        ghin.save(update_fields=["archived_at"])
                elif apply_changes:
                    ghin.delete()
                    self.stdout.write("   nothing left to keep — project deleted")

                if not apply_changes:
                    transaction.set_rollback(True)

        self.stdout.write(
            self.style.SUCCESS(
                f"{'APPLIED' if apply_changes else 'DRY RUN'} — kept {touched_total}, "
                f"moved {untouched_total}, backfilled {backfilled} triage rows"
            )
        )
        if not apply_changes:
            self.stdout.write("Nothing was written. Re-run with --apply to make it so.")
