# Arribada customizations to Plane

Arribada's fork of [Plane](https://github.com/makeplane/plane) (`arribada/plane`, branch
**`arribada/main`**). Backend work lives in a self-contained Django app **`plane.arribada`**
(`apps/api/plane/arribada/`). Frontend work is split: new surfaces go in `apps/web/ce/`,
but ~87 upstream files under `apps/web/core/` are edited in place too, so "our changes are
all in `ce/`" is not true and never was.

> **No secrets in this repo.** Credentials live in `.env.plane` on the deploy host, never
> committed. Every integration is **dormant** until its env vars are set — no errors, no
> logs, just nothing happening. That is deliberate, and it is also how three separate
> features have been silently off for weeks.

## Orientation

Numbers, so you can tell at a glance when this file has rotted again:

|                                                      |                                                          |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `plane.arribada` migrations                          | `0001` → `0037` (own graph, see traps)                   |
| Models in `models.py`                                | 26                                                       |
| Endpoint classes in `views.py` / routes in `urls.py` | 72 / 72                                                  |
| Python files in the app                              | 38 (18 source, 17 tests, 3 package markers)              |
| `arribada-*` celery beat entries                     | 5                                                        |
| `@shared_task` functions                             | 5                                                        |
| Web diff vs upstream                                 | 292 files, ~33k insertions (147 in `ce/`, 87 in `core/`) |

Regenerate any of these rather than trusting them:

```sh
git log --oneline -- apps/api/plane/arribada/            # our backend commits
git diff --stat $(git merge-base preview arribada/main) arribada/main -- apps/web
```

---

## Traps

Each of these cost at least a day, or shipped broken and was reported by a user. They all
share one shape: **a green typecheck, a clean lint and a passing test suite, and the
feature is not there.**

### A route not declared in `apps/web/app/routes/core.ts` does not exist

React Router v7 with an **explicit route manifest** — the folders under `app/(all)/…` are
inert. Nothing else imports a page component, so Vite tree-shakes the whole page out of
the bundle. The symptom is that the source contains a string the _served bundle does not_.
Grep the built bundle, not the source. (`b2f049962f`)

Two sub-traps:

- **`extended.ts` is not a second `core.ts`.** Finance was declared there, at top level,
  which put it outside the project layout: no sidebar, no header, none of the scroll
  container `ContentWrapper` provides, and outside the project context the budget block
  reads from. `extended.ts` is for routes that must inherit _no_ wrapper — the public
  timeline is the only legitimate resident. (`95b7f17b90`, `4ec88aafc3`)
- Static segments must be declared **before** the `:param` route that would otherwise
  swallow them (see `profile/:userId/timeline` next to `activity`).

### A sidebar entry has to be registered in four places

Declaring a nav item and rendering one are different acts, and the second list is easy to
miss because the first one makes the feature reachable from _somewhere_.

**Project section** (e.g. Finance):

1. `packages/constants/src/project.ts` — the `EProjectFeatureKey` member
2. `apps/web/ce/components/projects/navigation/helper.tsx` — the breadcrumb feature dropdown
3. `apps/web/core/components/workspace/sidebar/project-navigation.tsx` — the sidebar's own
   separate `baseNavigation` list
4. `apps/web/app/routes/core.ts` — the route, nested in the project layout

**Workspace section** (e.g. GitHub triage, Portfolio, Workload):

1. `packages/constants/src/workspace.ts` → `WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS` (declaration)
2. `packages/constants/src/workspace.ts` → `…STATIC_PINNED_NAVIGATION_ITEMS_LINKS` (**the array that is actually mapped over**)
3. `apps/web/core/components/workspace/sidebar/sidebar-item.tsx` — the `staticItems` allow-list
4. `apps/web/core/components/workspace/sidebar/sidebar-menu-items.tsx` — the renderer

Also give the item an explicit `sortOrder`; a tie leaves the order depending on array
position rather than intent. (`4d98a1da71`, `2cbd04390f`)

### `@/plane-web/*` resolves to `apps/web/ce/*`

Defined once, in `apps/web/tsconfig.json` `paths`; Vite reads it via `vite-tsconfig-paths`
rather than redeclaring it. Upstream points this specifier at `ee/` in the enterprise
build — **this fork has no `ee/`**, so it is always `ce/`. `core/` and `ce/` hold
same-named siblings, so `@/components/x` and `@/plane-web/components/x` are _different
files_: edit the wrong one and you get a clean build and zero behaviour change.

### `t()` renders the missing key, not a fallback

Any string this fork adds has no upstream catalogue entry, so `t("sidebar.finance")` puts
the literal `sidebar.finance` on screen. Add real entries to `packages/i18n/src/locales/{en,fr}/`
**and** keep the defensive fallback to the nav item's `name`. Lowercase single-word keys
(`"portfolio"`, `"workload"`) read correctly by luck and hide the same bug. (`ac96d2892b`)

Vocabulary: **Plane's "Cycle" is a sprint here.** Only translation _values_ were changed —
keys are code and stay `cycle`. "V-cycle" in the setup wizard is the V-model, not a Plane
cycle, and is deliberately untouched. (`b5c3d30861`)

### `@shared_task` must sit directly on its `def`

Twice in one day an edit anchored on `\ndef github_plane_sync():` landed _between_ the
decorator and its function, so `@shared_task` decorated the helper above it. The module
imports, `manage.py check` is clean, every test passes — and Celery never registers the
task, beat schedules a name no worker knows, and the "Sync now" button 502s. (`1e27f8b553`)

Companion: Celery autodiscovery only scans `<app>/tasks.py`, and this app has a module per
task, so **every task module must be imported by name in `ArribadaConfig.ready()`**
(`apps.py`). `scope_snapshot_task` was missed and the snapshot table stayed empty for
weeks while beat fired daily. (`28e614c990`)

`test_beat_schedule.py` guards both. Do not delete it.

### `plane.arribada` has its own migration graph

`apps.py` sets `label = "arribada"`, so this app keeps a `django_migrations` lineage
independent of `plane.db`, and every table is namespaced `arribada_*` via `Meta.db_table`.
Cross-app dependencies on `db` are **named explicitly** in the migration, never inferred —
this app must not assume `db`'s history is applied (see `0036_expense_work_item.py`).

A migration that is written but not registered in the graph typecheck-passes and is
silently skipped. And a hand-written `AlterField` that disagrees with its model leaves the
graph permanently dirty, so every later `makemigrations` wants to correct it. (`7682930249`)

**Production has run unpushed code before.** The `ProjectAffineDoc` → `ProjectWikiDoc`
rename and its migration `0009` were already applied in prod while absent from git;
deploying the branch as it stood would have pointed code at a dropped table. To detect it:
`docker cp` the app out of the running container and diff it against HEAD, and compare
`select tablename from pg_tables where tablename like 'arribada%'` against the models'
`db_table` values. **`docker ps` will not tell you** — the fork images are re-tagged
`makeplane/plane-*:v1.3.1`. (`4ba6a175fc`)

### `Project.objects` is a `SoftDeletionManager`

Soft-deleting a project makes `Project.objects.filter(...)` stop matching it, and four
separate surfaces went silently empty — one of them rendering "Nothing is stuck" while 27
issues were stuck. Conversely `link.project` is a plain FK join and applies **no** manager,
so it returns rows `Project.objects` hides; a soft-deleted project stayed publicly
readable. Same for `issue.assignees`, which goes through a soft-deleted table — use the
explicit `IssueAssignee` join. (`e15bc97d29`, `4ec88aafc3`, `95b7f17b90`)

### Two smaller ones with a long tail

- **Unit mismatches discard rows silently.** `if rate.currency != allocation_currency:
continue` blanked the spend chart on all 52 projects, reported three times, because
  every rate is GBP and every allocation was the untouched EUR default. Name what you
  cannot convert; never `continue` past it. (`a97c9df93a`)
- **Python `round()` is banker's rounding.** `round(2.5) == 2`, so half-day effort was
  under-planned by a day. Use `ceil`. (`92e83ef6a5`)

### Money is `MONEY_ROLES` **and** `level="PROJECT"`

The rest of this app runs `allow_permission(..., level="WORKSPACE")` and scopes itself with
`_visible_projects`, which only asks whether the caller is on the project at all. That is
fine for `VIEWER_ROLES` — all three roles are on it — and wrong for money, because the role
tested is then the caller's _workspace_ role: a workspace MEMBER who is a project GUEST read
the budget. `level="PROJECT"` asks the project, and keeps upstream's explicit fall-through
for workspace admins. See the comment on `MONEY_ROLES` in `views.py` and
`test_money_permissions.py`.

---

## Backend (`apps/api/plane/arribada/`)

| File                                         | Purpose                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models.py`                                  | The 26 models — schedules, baselines, effort/allocation, disciplines, finance, milestones, artifacts, checklists, folders, GitHub, public timelines, AI settings |
| `views.py`                                   | 72 endpoint classes; defines `VIEWER_ROLES`, `MONEY_ROLES`, `GANTT_RELATION_TYPES`                                                                               |
| `urls.py`                                    | 72 routes, all named `arribada-*`, mounted at `/api/arribada/`                                                                                                   |
| `serializers.py`                             | One DRF serializer (`ProjectScheduleSerializer`); the rest hand-serialize                                                                                        |
| `scheduling.py`                              | Pure FS/SS `cascade`, `critical_path`, `slack_for_issues` — no ORM                                                                                               |
| `blueprints.py`                              | Device-project blueprint (V-model tracks/phases/tasks) + working-day scheduler, sprint splitter, float — no ORM                                                  |
| `holidays.py`                                | GB/FR public holidays, computed, with substitute-day rules                                                                                                       |
| `rate_presets.py`                            | Indicative hourly rates per market + EUR/GBP conversion                                                                                                          |
| `ai.py`                                      | Provider-agnostic LLM client; key resolved workspace row → env → Plane instance config                                                                           |
| `github_sync_task.py`                        | GitHub → Plane ingestion and closure reconciliation                                                                                                              |
| `github_classification_task.py`              | Daily triage-queue warnings                                                                                                                                      |
| `github_enrich.py`                           | GitHub metadata → Plane fields; declines rather than guesses                                                                                                     |
| `reminder_task.py`                           | Daily overdue / due-today / due-tomorrow reminders                                                                                                               |
| `notify_forward.py`                          | Forwards Plane notifications to the Arribada dashboard                                                                                                           |
| `scope_snapshot_task.py`                     | Daily cycle scope row (burndown history)                                                                                                                         |
| `zulip_notify.py`                            | Best-effort Zulip poster                                                                                                                                         |
| `management/commands/retire_github_inbox.py` | One-shot: retired the GHIN inbox project (below)                                                                                                                 |

17 test files, run with `python -m pytest plane/arribada/` from `apps/api`. They need a real
Postgres (`pytest.ini` uses `--reuse-db --nomigrations`).

### Beat schedule (`apps/api/plane/celery.py`)

| Entry                                     | Schedule                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| `arribada-cycle-scope-snapshot`           | 23:50 UTC — the last moment still "today" for the team |
| `arribada-due-date-reminders`             | 06:00 UTC                                              |
| `arribada-github-classification-warnings` | 06:30 UTC                                              |
| `arribada-github-plane-sync`              | every 30 min (no-op without `GITHUB_PAT`)              |
| `arribada-notification-forward`           | every 10 min, re-sending a 45-min window               |

---

## Feature areas

**Portfolio & Gantt.** Project-level planned dates (`ProjectSchedule`, upstream has none),
dependency arrows and drag-to-link, % complete fill, undo, weekend-aware cascade
auto-schedule, cross-project critical path, gantt grouping bands.

**Baselines & progress.** Versioned `ProjectBaseline` / `BaselineEntry` snapshots plus
per-issue `IssueBaseline`, variance chips, and `CycleScopeSnapshot` for scope creep the
burndown cannot show (it recomputes history from the cycle's _current_ total).

**Effort vs dates.** `IssueEffort` is person-days, independent of duration. `IssueAllocation`
is a percent **per assignee** (two people on one item routinely give it different shares),
and **a missing row means 100%** — deliberately over-stating load, because a planner that
quietly reports spare capacity is the worse failure. Workload and workload-timeline sit on
top of both.

**Disciplines & roster.** `ProjectDiscipline` (what the project needs, covered or not),
`IssueRole` (what an item needs, independent of who is assigned), `ProjectTeamMember` (who
is on it, which disciplines, which country → which holiday table). Gap endpoints for
discipline / assignee / undated.

**Finance.** `ProjectBudget` endpoint (allocation and what is drawn against it),
`ProjectExpense` (non-labour spend, with supplier link and part number), `ProcurementRequest`
(purchase request → lead's decision → expense line), `WorkspaceRoleRate` (hourly cost per
discipline), `IssueFixedCost` (an item a supplier delivers: priced, not costed as our time),
`WorkspaceCurrencySettings`, cost-by-sprint, spend rhythm, and a cross-project my-approvals
queue. Read/write rules: see the money trap above. There is no funder-report _route_ — the
funder report is a payload shape assembled from the milestones and budget endpoints.

**Milestones & evidence.** `IssueMilestone` marks an item as a deliverable and carries the
funder-facing label; `IssueArtifact` records where the proof lives. A milestone used to be
inferred from a zero-day duration, which was wrong in both directions.

**Checklists.** `IssueChecklistItem` — a work item that belongs to another work item's
checklist, plus a per-project summary.

**Saved orders.** `ProjectIssueOrder` — a named, saved arrangement of a project's items,
appliable later.

**GitHub.** Sync into real projects plus a **triage queue** (`GithubIssue`, keyed by
workspace/repo/number, with a `dismissed` flag). The old "GitHub Inbox" (GHIN) project is
**retired** — `retire_github_inbox.py` moved untouched mirrored issues into `GithubIssue`
and archived rather than deleted anything a human had touched. (`e15bc97d`, `9adb1a52`)

**Published timelines.** `ProjectPublicTimeline` — a read-only, no-login schedule link.
`public/timeline/<anchor>/` deliberately carries no slug and no project id: the anchor is
the only credential, so nothing the caller supplies can widen what is read.
`test_public_timeline.py` pins the exact published field set.

**Your work / home.** A my-work panel and per-user timeline; project folders in the
sidebar (`ProjectFolder` + `ProjectFolderItem`, cycle-checked on move); `ProjectStatusUpdate`
health posts.

**Stickies.** Upstream's notes, extended in `apps/web/core/components/stickies` with free
positioning, resize and a one-click tidy. (`84383153a9`)

**AI planning assistant.** Draft an item, draft a plan, generate sprint tasks, apply a
plan; provider and key per workspace (`WorkspaceAiSettings`).

**Team Hub.** `hub-projects` feeds the Arribada dashboard, gated on `HUB_LINKS_SECRET`.
`ProjectWikiDoc` is the per-project link record (wiki, Drive, chat, GitHub repos).

---

## Configuration

All read directly via `os.environ` inside the app — nothing arribada-specific is in
`plane/settings/`.

| Env var(s)                                                                                 | Enables                                                                                                     | Without it                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GITHUB_PAT` (+ `GITHUB_SYNC_REPOS`)                                                       | GitHub sync. `GITHUB_SYNC_REPOS` **adds to** the repos mapped on `ProjectWikiDoc`, it does not replace them | sync is a silent no-op                                                          |
| `ARRIBADA_NOTIFY_URL` + `ARRIBADA_NOTIFY_SECRET`                                           | Forwarding Plane notifications to the dashboard bell                                                        | no-op                                                                           |
| `HUB_LINKS_SECRET`                                                                         | `hub-projects` and `team-sync` (server-to-server, `X-Hub-Secret`)                                           | endpoints answer 503 `not_configured`                                           |
| `ARRIBADA_AI_API_KEY` (or `GROQ_API_KEY`), `ARRIBADA_AI_PROVIDER` / `_BASE_URL` / `_MODEL` | AI assistant, deploy-wide. Falls back to the workspace row, then Plane instance config                      | assistant unavailable                                                           |
| `ARRIBADA_ZULIP_SITE` / `_BOT_EMAIL` / `_API_KEY`                                          | Reminders → Zulip channel                                                                                   | no-op                                                                           |
| `WEB_URL`                                                                                  | Correct links in reminders and forwarded notifications                                                      | reminders default to `https://plane.arribada.org`; forwarded links are relative |

---

## CI (`.github/workflows/arribada-build.yml`)

Builds on GitHub Actions, **not** on the droplet: the web build peaks at 2-4 GB and the
droplet has ~3.8 GB free next to a live Postgres, so the OOM killer would take out
production rather than the build. The backend image is pushed to
`ghcr.io/arribada/plane-backend:$TAG`; the web image is `workflow_dispatch` only (30-40 min)
and ships as a gzipped tar artifact.

Four guards, each earned:

1. `makemigrations arribada --check --dry-run`, run **inside the shipped image** and scoped
   to `arribada`. On the runner it reports phantom drift, because Plane derives timezone
   choices from the system tz database and a newer tzdata reports changes in upstream's
   `db` app.
2. A route assertion — the app can be in `INSTALLED_APPS` and still be unreachable if
   `urls.py` is not wired.
3. The arribada test suite, in the candidate image **before** the push, so a red test
   cannot produce a deployable artifact.
4. A **minimum collected-test count**. `pytest.ini` collects `test_*.py`, and these files
   were once `tests_*.py`: the run collected zero and went green while testing nothing.
   Exit code 5 catches losing them all; the floor catches losing some. **Raise the floor
   when you add tests.**

Gotchas in that file: `+` is legal semver build metadata and **illegal** in a Docker tag; a
multi-line `python -c` inside a `run: |` block is a parse error whether or not you indent
it, hence the deliberate one-liners; `grep -c` exits 1 on zero, so the count is guarded with
`|| true` or `set -e` kills the script before the diagnostic prints.

`pnpm/action-setup@v4` takes **no** `version:` — pnpm is pinned by `packageManager` in
`package.json` and passing both makes the action error. `turbo.json` has
`check:types` `dependsOn: ["^build"]`, so workspace packages must build before `apps/web`
typechecks; running `tsc` directly in `apps/web` gives misleading errors.
