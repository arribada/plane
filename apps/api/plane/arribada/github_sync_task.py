# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Periodic GitHub -> Plane ingestion. Pulls OPEN issues from the GitHub repos the
# team has mapped to projects (ProjectWikiDoc.github_repo_urls), or an explicit
# GITHUB_SYNC_REPOS allowlist, and UPSERTs them into the GHIN inbox project keyed
# on external_id — so re-runs update instead of duplicating. The existing
# github_classification task then routes each into its real project.
#
# Dormant unless GITHUB_PAT is set (then it also lights up the classification task
# and the Team-Hub activity feed, which read the same token). Scoped to mapped
# repos on purpose, so a first run can't flood GHIN with every open org issue.

import os
from datetime import timedelta

import requests
from celery import shared_task
from django.utils import timezone

GITHUB_API = "https://api.github.com"


def _repos_to_sync():
    """owner/repo set: explicit GITHUB_SYNC_REPOS, else every repo mapped to a project."""
    from plane.arribada.models import ProjectWikiDoc
    from plane.arribada.views import _github_url  # reuse the hardened extractor

    explicit = os.environ.get("GITHUB_SYNC_REPOS", "").strip()
    if explicit:
        repos = set()
        for part in explicit.split(","):
            part = part.strip().removesuffix(".git").strip("/")
            if part:
                repos.add(part.lower())
        return repos

    repos = set()
    for doc in ProjectWikiDoc.objects.exclude(github_repo_urls=[]):
        for url in doc.github_repo_urls or []:
            u = _github_url(url) or str(url)
            # take owner/repo from a github.com url
            m = u.lower().split("github.com/", 1)
            if len(m) == 2:
                parts = m[1].strip("/").split("/")
                if len(parts) >= 2:
                    repos.add(f"{parts[0]}/{parts[1]}".removesuffix(".git"))
    return repos


def _fetch_open_issues(pat, repo, max_pages=5):
    """Open (non-PR) issues for owner/repo, newest-updated first."""
    out = []
    headers = {"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"}
    for page in range(1, max_pages + 1):
        try:
            r = requests.get(
                f"{GITHUB_API}/repos/{repo}/issues",
                headers=headers,
                params={"state": "open", "sort": "updated", "direction": "desc", "per_page": 100, "page": page},
                timeout=15,
            )
        except Exception:
            break
        if r.status_code != 200:
            break
        items = r.json()
        if not isinstance(items, list) or not items:
            break
        # the issues endpoint returns PRs too — drop them
        out.extend([it for it in items if "pull_request" not in it])
        if len(items) < 100:
            break
    return out


@shared_task
def github_plane_sync():
    from plane.db.models import Issue, Project, State, WorkspaceMember

    pat = os.environ.get("GITHUB_PAT")
    if not pat:
        return {"skipped": "GITHUB_PAT not set"}

    repos = _repos_to_sync()
    if not repos:
        return {"skipped": "no repos mapped (set GITHUB_SYNC_REPOS or link repos to projects)"}

    # fetch once; the same issues feed every GHIN project (usually just one)
    by_repo = {repo: _fetch_open_issues(pat, repo) for repo in repos}
    total_fetched = sum(len(v) for v in by_repo.values())

    created = updated = 0
    for ghin in Project.objects.filter(identifier="GHIN").select_related("workspace"):
        author_id = ghin.created_by_id or (
            WorkspaceMember.objects.filter(workspace=ghin.workspace, is_active=True)
            .values_list("member_id", flat=True)
            .first()
        )
        default_state = (
            State.objects.filter(project=ghin, default=True).first()
            or State.objects.filter(project=ghin).order_by("sequence").first()
        )

        for repo, issues in by_repo.items():
            for gh in issues:
                gid = str(gh.get("id") or "")
                if not gid:
                    continue
                url = gh.get("html_url") or f"https://github.com/{repo}"
                title = (gh.get("title") or "").strip()[:250] or f"{repo}#{gh.get('number')}"
                # the description carries the repo url so classification can map it
                desc_html = f'<p><a href="{url}">{url}</a></p>'

                existing = Issue.objects.filter(
                    project=ghin, external_source="github", external_id=gid
                ).first()
                if existing:
                    fields = []
                    if existing.name != title:
                        existing.name = title
                        fields.append("name")
                    if url not in (existing.description_html or ""):
                        existing.description_html = desc_html
                        fields.append("description_html")
                    if fields:
                        existing.save(update_fields=fields)
                        updated += 1
                else:
                    Issue.objects.create(
                        workspace=ghin.workspace,
                        project=ghin,
                        name=title,
                        description_html=desc_html,
                        external_source="github",
                        external_id=gid,
                        state=default_state,
                        created_by_id=author_id,
                    )
                    created += 1

    return {"repos": len(repos), "fetched": total_fetched, "created": created, "updated": updated, "at": str(timezone.now())}
