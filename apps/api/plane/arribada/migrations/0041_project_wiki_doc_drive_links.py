# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""One Google Drive link per project becomes several, without losing the one.

There are real links in production behind this column — every project that has
been set up has one — so the only acceptable shape here is: read the existing
value, write it into the list, and leave the column where it is.

REVERSIBILITY, since this fork has a poor record of it (`0038` and `0014` both
reverse to a no-op that admits it cannot undo a deletion). This one reverses for
real. `google_drive_url` is not dropped; it is kept as a derived mirror of the
first link, which means:

  forward   every row with a link gets `[{"url": <it>, "label": ""}]`
  backward  every row's `google_drive_url` is rewritten from `links[0]["url"]`,
            and the column is then the only survivor — which is exactly the
            state the schema on the other side of this migration describes

The honest caveat, stated rather than buried: reversing a project that has
since added a SECOND or third Drive link keeps the first and drops the rest.
That is not a defect of the reverse — a `CharField` cannot hold three URLs — and
it is why the reverse rewrites the column instead of assuming it is still
accurate. A row whose first link was changed after the upgrade would otherwise
roll back to the link it had in July.

The label of a migrated value is empty, deliberately. Inventing one ("Drive",
"Project files") would put a caption nobody wrote under a link somebody did, and
the panel already has a good answer for an unlabelled link: it shows the URL.
"""

from django.db import migrations, models


def single_to_list(apps, schema_editor):
    """Every existing `google_drive_url` becomes the first entry of the list."""
    ProjectWikiDoc = apps.get_model("arribada", "ProjectWikiDoc")
    doomed = []
    for row in ProjectWikiDoc.objects.exclude(google_drive_url=None).exclude(
        google_drive_url=""
    ).only("id", "google_drive_url", "google_drive_links"):
        # Idempotent: a row that somehow already has a list is left alone rather
        # than having its first entry duplicated. This migration runs once, but a
        # migration that is only correct once is a migration nobody can re-run
        # against a restored backup.
        if row.google_drive_links:
            continue
        row.google_drive_links = [{"url": row.google_drive_url.strip(), "label": ""}]
        doomed.append(row)
    # In batches, for the same reason 0038 batches: `bulk_update` with one
    # enormous CASE is a query planner's worst day, and this table has a row per
    # project.
    for start in range(0, len(doomed), 500):
        ProjectWikiDoc.objects.bulk_update(
            doomed[start : start + 500], ["google_drive_links"], batch_size=500
        )


def list_to_single(apps, schema_editor):
    """Backwards: the column becomes the first link again, for real.

    Not a no-op. `google_drive_url` is a derived mirror after the upgrade, and a
    reverse that trusted the mirror would restore whatever was there before the
    first link was last edited. Rewriting it from the list is what makes the
    rollback land on the plan people can actually see.
    """
    ProjectWikiDoc = apps.get_model("arribada", "ProjectWikiDoc")
    changed = []
    for row in ProjectWikiDoc.objects.only(
        "id", "google_drive_url", "google_drive_links"
    ):
        first = None
        for entry in row.google_drive_links or []:
            url = (entry or {}).get("url") if isinstance(entry, dict) else entry
            if url:
                first = str(url).strip()[:1024]
                break
        if first and row.google_drive_url != first:
            row.google_drive_url = first
            changed.append(row)
    for start in range(0, len(changed), 500):
        ProjectWikiDoc.objects.bulk_update(
            changed[start : start + 500], ["google_drive_url"], batch_size=500
        )


class Migration(migrations.Migration):
    dependencies = [("arribada", "0040_project_schedule_lead_only_edits")]

    operations = [
        migrations.AddField(
            model_name="projectwikidoc",
            name="google_drive_links",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(single_to_list, list_to_single),
    ]
