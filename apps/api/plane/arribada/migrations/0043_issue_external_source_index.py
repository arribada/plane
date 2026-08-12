# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The index the new `?external_source=` filter needs and upstream never had.

`external_id` and `external_source` are declared on fourteen upstream models and
indexed on NONE of them — plain `CharField(max_length=255, null=True)` every
time, no `db_index`, no `Meta.indexes`, no `unique_together`, and no migration in
`plane/db/migrations/` that adds one. So the filter added to
`IssueListCreateAPIEndpoint.get` in this same change would, without this, scan
every row of `issues` belonging to the project on every sync cycle — a filter
that reads the whole table to avoid reading the whole table over HTTP.

WHY IT LIVES IN THE ARRIBADA GRAPH AND NOT IN `db`. `Issue` is upstream's model,
and adding to `Issue.Meta.indexes` would put a fork-only entry in the migration
graph `makeplane/plane` also numbers — the merge conflict that ends with somebody
choosing upstream's version and silently dropping the index. Raw SQL from this
app's own graph touches the same table without claiming any of upstream's
migration state: `db`'s autodetector does not know this index exists, and
therefore will never generate a migration to remove it.

WHY PARTIAL. `external_source IS NOT NULL` is true for a small minority of rows —
everything a person typed into the UI has it null. Measured on production
2026-08-12: 12 rows of 597 carry one, all of them `github`. So the partial index
is a fraction of the size of a full one and is never consulted for the ordinary
reads that make up almost all of this table's traffic.

A NOTE ON SCALE, so the next reader does not over-read this. At 597 rows the
planner will pick a sequential scan anyway and be right to. This index is for the
table this becomes, not the table it is — the cost of adding it now is one small
partial index, and the cost of not having it is a filter that quietly degrades
with the row count on the one caller that runs every fifteen minutes.

WHY `(project_id, external_source)` IN THAT ORDER. The endpoint is project-scoped
and always filters `project_id` first; leading with it means the index also
serves the plain per-project reads that already existed. The remaining predicates
the manager adds (`deleted_at IS NULL`, not draft, not archived, not triage) are
applied to the handful of rows this leaves.

CONCURRENTLY, and therefore `atomic = False`. `issues` is the largest table in
this database and a plain `CREATE INDEX` takes ACCESS EXCLUSIVE for the whole
build — every read and write on work items blocked meanwhile. This is the case
`0039` explicitly said it did not have.

`IF NOT EXISTS` because a `CONCURRENTLY` build that fails leaves an INVALID index
behind rather than nothing, and the retry must not then fail on the name. If this
migration is ever reported as failed, check for an invalid index and drop it:
`SELECT relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
 WHERE NOT i.indisvalid;`

No RunPython — nothing to dump before it.
"""

from django.db import migrations


class Migration(migrations.Migration):
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
    atomic = False

    dependencies = [("arribada", "0042_project_schedule_external_edits")]

    operations = [
        migrations.RunSQL(
            sql="""
            CREATE INDEX CONCURRENTLY IF NOT EXISTS arribada_issue_external_source
            ON issues (project_id, external_source)
            WHERE external_source IS NOT NULL;
            """,
            reverse_sql="""
            DROP INDEX CONCURRENTLY IF EXISTS arribada_issue_external_source;
            """,
        )
    ]
