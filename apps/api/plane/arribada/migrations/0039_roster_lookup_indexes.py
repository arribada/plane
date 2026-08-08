# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The three indexes the roster's own hot lookups needed and never had.

Every read below already existed and already ran on production. None of them
could use an index, and EXPLAIN said so:

* `email__iexact` / `name__iexact` compile to `UPPER(col) = UPPER(%s)`. The only
  indexes on this table are the two partial unique constraints over the raw
  columns, and `UPPER(...)` matches neither — so the wiki sync sequential-scanned
  the roster twice per entry, inside an uncapped loop over the request body. The
  callers now emit `LOWER(col) = %s` (see `_ci` in views.py); these are the
  indexes that answers.

* `roles__contains=[role]` is JSONB containment (`@>`), which has no index-backed
  plan at all without GIN. It runs once per work item in the bulk discipline
  assignment — up to five hundred times in a single request — and once more per
  single assignment.

Index-only additions: no column changes, no data migration, nothing to reverse
badly. `AddIndex` takes an ACCESS EXCLUSIVE lock for the duration of the build,
which on a table of a few hundred roster rows is milliseconds; there is no case
here for `CONCURRENTLY` and the complexity it brings.
"""

import django.contrib.postgres.indexes
import django.db.models.functions.text
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("arribada", "0038_one_discipline_one_expense")]

    operations = [
        migrations.AddIndex(
            model_name="projectteammember",
            index=models.Index(
                django.db.models.functions.text.Lower("email"),
                "project",
                name="arribada_team_lower_email",
            ),
        ),
        migrations.AddIndex(
            model_name="projectteammember",
            index=models.Index(
                django.db.models.functions.text.Lower("name"),
                "project",
                name="arribada_team_lower_name",
            ),
        ),
        migrations.AddIndex(
            model_name="projectteammember",
            index=django.contrib.postgres.indexes.GinIndex(
                fields=["roles"], name="arribada_team_roles_gin"
            ),
        ),
    ]
