# Arribada customizations to Plane

This is Arribada's fork of [Plane](https://github.com/makeplane/plane) (`arribada/plane`,
branch **`arribada/main`**). Everything we add lives in a self-contained Django app
**`plane.arribada`** (`apps/api/plane/arribada/`) plus web changes under `apps/web/ce/`,
so our work is easy to separate from upstream.

> **No secrets in this repo.** All credentials live in `tools/.env.plane` on the deploy
> host (never committed). Integrations stay **dormant** until their env vars are set.

## See our changes at a glance
- **Backend:** everything under `apps/api/plane/arribada/` is ours — its own migration
  graph (`0001` → `0013`).
- **Commits:** `git log --oneline -- apps/api/plane/arribada/` — all tagged
  `feat(arribada)` / `[arribada]`.
- **Scheduled tasks we registered:** the `arribada-*` entries in `apps/api/plane/celery.py`.

## Backend modules (`apps/api/plane/arribada/`)
| File | Purpose |
|------|---------|
| `models.py` | `ProjectSchedule`, `IssueBaseline`, `ProjectWikiDoc`, `ProjectFolder(+Item)`, `ProjectStatusUpdate`, `WorkspaceAiSettings`, `ProjectTeamMember`, `IssueRole` |
| `views.py` / `serializers.py` / `urls.py` | Portfolio, scheduling, folders, workload, hub-projects, planning-assistant API |
| `scheduling.py` (+ `tests_scheduling.py`) | Weekend-aware cascade auto-schedule + critical path (pure functions, unit-tested) |
| `github_sync_task.py` | Periodic GitHub → Plane issue sync (dormant until `GITHUB_PAT`) |
| `github_classification_task.py` | GitHub-inbox classification warnings |
| `reminder_task.py` | Daily due-date reminders (in-app + optional Zulip) |
| `zulip_notify.py` | Best-effort Zulip poster (dormant unless `ARRIBADA_ZULIP_*` set) |
| `ai.py` | AI planning assistant |

## Feature areas

### Portfolio & Gantt (Asana-parity)
- Project-level **planned dates** (`ProjectSchedule`) — upstream Plane has none.
- Gantt **dependency arrows**, **drag-to-link** (FS/SS), per-issue **% complete** bar fill, **undo / Ctrl+Z**.
- **Baselines** (`IssueBaseline`) + baseline-vs-actual **variance chip**.
- **Weekend-aware cascade auto-schedule** + cross-project **critical path** + named **milestones**.
- Assignee avatars on bars, timeline filters, click-through to project.

### Per-project links — the "Pages" docs note (`ProjectWikiDoc`)
- One place per project linking the **Wiki** (docs.arribada.org / Colanode), **Google Drive**,
  **Chat** (Zulip channel), and one or more **GitHub** repos.
- Renamed `ProjectAffineDoc` → `ProjectWikiDoc` when the wiki moved AFFiNE → Colanode
  (migration `0009`); workspace default corrected (`0013`).

### GitHub integration
- Periodic **GitHub → Plane issue sync** into a "GitHub Inbox" project (dormant until `GITHUB_PAT`).
- Inbox **classification warnings**; **adopt** an inbox issue into a project; link **multiple
  GitHub tasks** to a work item as sub-issues.

### Shared project folders
- Workspace-shared **sidebar folders** (`ProjectFolder` + `ProjectFolderItem`) with drag-and-drop.

### Project health & workload
- Manual **project status** (`ProjectStatusUpdate`: on-track / at-risk / off-track).
- Per-person **workload** view (assigned / overdue / due-this-week / points).

### Roster, roles & planning assistant
- Project **roster with roles** (`ProjectTeamMember`, `IssueRole`).
- **AI planning assistant** (`ai.py`) + setup wizard + provider settings (`WorkspaceAiSettings`).

### Reminders → chat
- Daily **due-date reminders** (`reminder_task.py`, beat **06:00 UTC**): an in-app
  notification per assignee for overdue / due-today / due-tomorrow items, deduped ~once/day.
- Also posts **one compact reminder to the project's Zulip channel** (`zulip_notify.py`),
  dormant unless `ARRIBADA_ZULIP_*` is set, reusing the same 20h dedup.

### Team Hub integration
- **`hub-projects`** endpoint feeding the Arribada dashboard's Team Hub (task counts,
  progress, per-project links), secret-gated by `HUB_LINKS_SECRET`.

### Other
- NPI **project template** (clone a project), Home "My tasks" widget, reload-free bulk ops,
  cmd+k, and Arribada branding (the A mark, teal palette).

## Configuration (dormant until set, in `tools/.env.plane`)
| Env var(s) | Enables |
|------------|---------|
| `GITHUB_PAT` (+ `GITHUB_SYNC_REPOS`) | GitHub → Plane issue sync |
| `ARRIBADA_ZULIP_SITE` / `_BOT_EMAIL` / `_API_KEY` | Due-date reminders → project Zulip channel |
| `HUB_LINKS_SECRET` | Dashboard Team-Hub project directory |

## Build & deploy
The backend image is built on the deploy host from this tree
(`build-be.sh` → `arribada/plane-backend:v1.3.1-arribada.1`, retagged
`makeplane/plane-backend:v1.3.1`), then `api` / `worker` / `beat-worker` / `migrator` are
recreated. The web frontend is built via GitHub Actions.
