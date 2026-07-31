# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# "project lead" and "project manager" were two names for one job, so a roster could
# record the same person twice and a task asking for one would not find the other.
# Leading a project is not a discipline in the first place — that is
# ProjectTeamMember.is_lead, a flag on the person — so the discipline folds into
# "project manager" and the flag keeps its meaning.

from django.db import migrations

ALIASES = {"project lead", "project leader"}
SURVIVOR = "project manager"


def merge_forward(apps, schema_editor):
    ProjectTeamMember = apps.get_model("arribada", "ProjectTeamMember")
    IssueRole = apps.get_model("arribada", "IssueRole")

    for member in ProjectTeamMember.objects.all().iterator():
        roles = list(member.roles or [])
        rewritten, seen = [], set()
        for role in roles:
            name = SURVIVOR if str(role).strip().lower() in ALIASES else str(role).strip()
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            rewritten.append(name)
        if rewritten != roles:
            member.roles = rewritten
            member.save(update_fields=["roles"])

    # A work item could carry both names; the unique index is on (issue, role), so
    # the rename can collide. Delete the loser rather than let the save fail — the
    # requirement is unchanged either way.
    for row in IssueRole.objects.filter(role__in=list(ALIASES) + [a.title() for a in ALIASES]).iterator():
        if str(row.role).strip().lower() not in ALIASES:
            continue
        if IssueRole.objects.filter(issue_id=row.issue_id, role=SURVIVOR).exists():
            row.delete()
        else:
            row.role = SURVIVOR
            row.save(update_fields=["role"])


def merge_backward(apps, schema_editor):
    # Irreversible on purpose: nothing records which "project manager" rows used to
    # say "project lead", and inventing that back would be worse than leaving it.
    pass


class Migration(migrations.Migration):
    dependencies = [("arribada", "0013_wiki_workspace_default")]

    operations = [migrations.RunPython(merge_forward, merge_backward)]
