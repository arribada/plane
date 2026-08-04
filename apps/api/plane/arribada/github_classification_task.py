# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Daily "somebody has to decide this" warnings for the GitHub triage queue.
#
# The queue is the GithubIssue table: every issue the sync captured that nobody
# has filed and nobody has dismissed. It used to be the GHIN staging project, and
# the whole body of this task was a loop over `Project.objects.filter(
# identifier="GHIN")`. When GHIN was retired that loop stopped iterating, so the
# task ran daily and returned {"notifications": 0} forever — nobody was ever told
# an issue needed classifying, and nothing errored to say so.
#
# What is left to warn about is only what the router cannot do by itself:
#   - a repo SEVERAL live projects claim: unroutable by construction, because
#     guessing an owner would file work under a project that never asked for it.
#     The leads of the projects arguing over it are told, once a day per repo,
#     because the fix is to settle the repo rather than to file its issues one
#     by one.
#   - a repo NO project claims: nobody in particular is responsible, so every
#     active workspace member gets one digest a day.
#
# A repo exactly one project claims is absent from both. The sync files those on
# its next run, and warning about them would invite somebody to do by hand what
# already happens on its own.
#
# Deduped on receiver + sender + title within 20 hours, so a re-run inside the
# day is silent. Neither notification carries an entity_identifier: there is no
# work item yet — that is precisely what is being complained about — and the
# notification pane opens the triage list for this sender rather than trying to
# peek a work item that does not exist.

import re
from collections import defaultdict
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

TRIAGE_SENDER = "in_app:github_triage"
DIGEST_SENDER = "in_app:github_triage_digest"


def _repo_key(text):
    """owner/repo (lowercased) from any github url/href found in the text.

    Kept although this task no longer needs it: `GithubIssue.repo` is already a
    key. views._repo_key_for is the caller now, and moving the regex would make
    a bigger diff than the one bug being fixed.
    """
    if not text:
        return None
    m = re.search(r"github\.com[/:]+([^/\s]+/[^/\s?#\"'<>]+)", str(text), re.IGNORECASE)
    if not m:
        return None
    return m.group(1).lower().rstrip("/").removesuffix(".git")


@shared_task
def github_classification_warnings():
    from plane.db.models import Notification, Project, WorkspaceMember
    from plane.arribada.models import GithubIssue
    from plane.arribada.github_sync_task import _repo_claims

    since = timezone.now() - timedelta(hours=20)

    # Live projects only. `Project.objects` is a SoftDeletionManager so a deleted
    # project drops out here, while its wiki doc row survives — a retired project
    # must not keep voting on who owns a repo.
    projects = {
        str(row["id"]): row
        for row in Project.objects.filter(archived_at__isnull=True).values(
            "id", "name", "workspace_id", "project_lead_id"
        )
    }
    claims = {
        repo: [str(pid) for pid in owners if str(pid) in projects]
        for repo, owners in _repo_claims().items()
    }

    def _notify_once(receiver_id, workspace_id, sender, title, html, message):
        """One notification per receiver per title per day.

        Deduped on the title rather than on entity_identifier because there is no
        entity: the whole complaint is that no work item exists yet. The title
        names the repo, which is exactly the grain a person wants to be nagged at.
        """
        if not receiver_id or not workspace_id:
            return 0
        if Notification.objects.filter(
            receiver_id=receiver_id, sender=sender, title=title, created_at__gte=since
        ).exists():
            return 0
        Notification.objects.create(
            workspace_id=workspace_id,
            project=None,
            sender=sender,
            receiver_id=receiver_id,
            entity_identifier=None,
            entity_name="issue",
            title=title,
            message=message,
            message_html=html,
        )
        return 1

    def _owners(workspace_id, repo):
        """The projects of THIS workspace that claim the repo.

        Scoped by workspace because a GithubIssue row is keyed on one: a project
        in another tenant naming the same public repository must not make this
        workspace's issues look claimed, or routed, or anybody else's problem.
        """
        return [
            pid for pid in claims.get(repo, []) if projects[pid]["workspace_id"] == workspace_id
        ]

    # What is actually sitting in the queue, per workspace.
    contested = defaultdict(lambda: defaultdict(int))  # workspace -> repo -> count
    unclaimed = defaultdict(int)  # workspace -> count
    rows = GithubIssue.objects.filter(
        filed_issue__isnull=True, dismissed_at__isnull=True
    ).values_list("workspace_id", "repo")
    for workspace_id, repo in rows:
        owners = _owners(workspace_id, repo)
        if len(owners) == 1:
            # The router will file this on its next run. Saying anything here
            # would ask somebody to do by hand what already happens.
            continue
        if owners:
            contested[workspace_id][repo] += 1
        else:
            unclaimed[workspace_id] += 1

    def _members(workspace_id, admins_only=False):
        """Active humans in a workspace.

        Bot accounts are excluded: an integration user is a member of the
        workspace and would get every digest, which is 365 notifications a year
        nobody reads and the only receiver on an install where one bot outnumbers
        the humans.
        """
        query = WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True).exclude(
            member__email__startswith="bot_user_"
        )
        if admins_only:
            query = query.filter(role=20)  # ROLE.ADMIN
        return list(query.values_list("member_id", flat=True))

    created = 0

    for workspace_id, repos in contested.items():
        for repo, count in repos.items():
            owners = _owners(workspace_id, repo)
            names = sorted(projects[pid]["name"] for pid in owners)
            title = f"{repo} is claimed by {len(owners)} projects"
            body = (
                f"<p><b>{count}</b> GitHub issue(s) from <b>{repo}</b> cannot be routed: "
                f"{', '.join(names)} all claim it. Settle the repository and they file themselves.</p>"
            )
            leads = [projects[pid]["project_lead_id"] for pid in owners if projects[pid]["project_lead_id"]]
            # No lead on any of the claiming projects is the normal case on this
            # install — every project has the field empty. Telling nobody would
            # make this branch as silent as the GHIN loop it replaces, so the
            # workspace admins hear it instead: somebody has to be able to settle
            # a repo, and an unheard warning is the bug being fixed.
            receivers = leads or _members(workspace_id, admins_only=True)
            for uid in receivers:
                created += _notify_once(
                    uid,
                    workspace_id,
                    TRIAGE_SENDER,
                    title,
                    body,
                    {"repo": repo, "count": count, "projects": names},
                )

    for workspace_id, count in unclaimed.items():
        title = f"{count} unclassified GitHub task{'s' if count != 1 else ''}"
        body = (
            f"<p><b>{count}</b> GitHub issue(s) belong to no project yet — "
            f"link the repository or file them from the triage queue.</p>"
        )
        for uid in _members(workspace_id):
            created += _notify_once(
                uid, workspace_id, DIGEST_SENDER, title, body, {"count": count}
            )

    return {
        "notifications": created,
        "contested": sum(sum(r.values()) for r in contested.values()),
        "unclaimed": sum(unclaimed.values()),
    }
