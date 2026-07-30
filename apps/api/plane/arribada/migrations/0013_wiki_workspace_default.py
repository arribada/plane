# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# The wiki-doc workspace default was still the AFFiNE workspace UUID, which no
# longer exists: any project linked from now on would have produced a deep link
# into a workspace docs.arribada.org has never heard of. Repoints the default and
# rewrites any row still carrying the dead id (there are none in production today,
# but a fresh install seeded from an old dump would have them).

from django.db import migrations, models

OLD = "5b320010-0d8d-4ccc-b4f6-dbe339c42b4e"
NEW = "01ky60b09cad2nyfk7c75e6555wc"


def repoint(apps, schema_editor):
    apps.get_model("arribada", "ProjectWikiDoc").objects.filter(workspace_id=OLD).update(workspace_id=NEW)


def unrepoint(apps, schema_editor):
    apps.get_model("arribada", "ProjectWikiDoc").objects.filter(workspace_id=NEW).update(workspace_id=OLD)


class Migration(migrations.Migration):

    dependencies = [
        ("arribada", "0012_issuerole"),
    ]

    operations = [
        migrations.AlterField(
            model_name="projectwikidoc",
            name="workspace_id",
            field=models.CharField(default=NEW, max_length=64),
        ),
        migrations.RunPython(repoint, unrepoint),
    ]
