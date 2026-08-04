# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# GitHub-inbox triage warnings. GitHub issues land in the "GHIN" staging project.
# For each open GHIN task:
#   - if its repo is one linked to a real project (ProjectWikiDoc.github_repo_urls),
#     warn that project's lead (the PM) to classify it — and its assignee, if any;
#   - otherwise it's unclassified; once per day every workspace member gets one
#     digest of how many GitHub tasks still need triage.
# Deduped to fire at most once per receiver+task (or per receiver, for the digest)
# per day, mirroring the due-date reminder.

import re
from datetime import timedelta

from celery import shared_task
from django.utils import timezone


def _repo_key(text):
    """owner/repo (lowercased) from any github url/href found in the text."""
    if not text:
        return None
    m = re.search(r"github\.com[/:]+([^/\s]+/[^/\s?#\"'<>]+)", str(text), re.IGNORECASE)
    if not m:
        return None
    return m.group(1).lower().rstrip("/").removesuffix(".git")


@shared_task
def github_classification_warnings():
    from plane.db.models import Issue, IssueAssignee, Notification, Project, WorkspaceMember
    from plane.arribada.models import ProjectWikiDoc

    since = timezone.now() - timedelta(hours=20)

    # 1) repo -> owning project (with its lead) map
    repo_to_project = {}
    for doc in ProjectWikiDoc.objects.exclude(github_repo_urls=[]).select_related(
        "project", "project__project_lead", "project__workspace"
    ):
        for url in doc.github_repo_urls or []:
            key = _repo_key(url)
            if key:
                repo_to_project[key] = doc.project

    def _notify_once(receiver_id, entity_id, sender, workspace, project, title, html, message):
        if not receiver_id:
            return 0
        exists = Notification.objects.filter(
            receiver_id=receiver_id, sender=sender, created_at__gte=since,
            **({"entity_identifier": entity_id} if entity_id else {"entity_identifier__isnull": True}),
        ).exists()
        if exists:
            return 0
        Notification.objects.create(
            workspace=workspace, project=project, sender=sender, receiver_id=receiver_id,
            entity_identifier=entity_id, entity_name="issue", title=title, message=message, message_html=html,
        )
        return 1

    created = 0
    # 2) scan every GitHub-inbox (GHIN) project's open tasks
    for ghin in Project.objects.filter(identifier="GHIN").select_related("workspace"):
        unclassified = []
        open_tasks = Issue.issue_objects.filter(project=ghin, deleted_at__isnull=True).exclude(
            state__group__in=["completed", "cancelled"]
        )
        for task in open_tasks:
            key = _repo_key(task.description_html or "")
            target = repo_to_project.get(key) if key else None
            if not target:
                unclassified.append(task)
                continue
            # known repo -> warn the target project's lead to classify
            # project=ghin, not the target: `entity_identifier` is a GHIN issue,
            # and a notification whose project and entity disagree sends the pane
            # looking for the item in a project it does not live in. The target is
            # named in the message, which is where that belongs.
            created += _notify_once(
                target.project_lead_id, task.id, "in_app:github_triage", target.workspace, ghin,
                f"Classify: {task.name}",
                f"<p>GitHub task <b>{task.name}</b> (repo {key}) belongs to <b>{target.name}</b> — adopt/classify it.</p>",
                {"repo": key, "target_project": str(target.id)},
            )
            # known user -> warn the assignee(s) too
            for uid in IssueAssignee.objects.filter(issue=task).values_list("assignee_id", flat=True):
                created += _notify_once(
                    uid, task.id, "in_app:github_triage", target.workspace, ghin,
                    f"Classify your task: {task.name}",
                    f"<p>Your GitHub task <b>{task.name}</b> (repo {key}) should be classified into <b>{target.name}</b>.</p>",
                    {"repo": key, "target_project": str(target.id)},
                )

        # 3) unclassified (unknown repo/project) -> one daily digest per active member
        if unclassified:
            n = len(unclassified)
            for uid in WorkspaceMember.objects.filter(
                workspace=ghin.workspace, is_active=True
            ).values_list("member_id", flat=True):
                created += _notify_once(
                    uid, None, "in_app:github_triage_digest", ghin.workspace, ghin,
                    f"{n} unclassified GitHub task{'s' if n != 1 else ''}",
                    f"<p><b>{n}</b> GitHub inbox task(s) aren't linked to a project yet — please triage.</p>",
                    {"count": n},
                )

    return {"notifications": created}
