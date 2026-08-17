# Handover — Arribada Plane fork, 2026-08-10 (reconciled 2026-08-17)

State of the work after a four-agent audit and several fix passes. Written so a fresh
session can continue without re-deriving anything.

> **Reconciled 2026-08-17.** This file had production on `.89` / `c77edfad9e`. It was
> wrong by one deploy. Verified against the running system (`docker inspect` on image
> **ids**, not tags): production serves **`.90`**, both backend and frontend built from
> **`aa13efe486`** — the same commit that is now the tip of `arribada/main` on the remote.
> The three commits the old text called "neither built nor deployed" (the three-pass
> frontend, its CI floor, and the wiki-sync `external_edits` backend pass) are **all
> deployed**. DB reconciled too: migrations `0042` and `0043` are applied, 0 invalid
> indexes. Note: the **local** `arribada/main` branch ref on the droplet was left stranded
> at `c77edfad9e`; the remote and the running images are at `aa13efe486`.

## Where things stand

Production `plane.arribada.org` serves **`aa13efe486`** — image tag
`v1.3.1-arribada.90`, backend image id `6a0c7e1faffd`, frontend `d37d47244cf4`,
built 2026-08-12 16:49, deployed ~2026-08-13 (containers up 4 days as of 2026-08-17).
OCI label `org.opencontainers.image.revision` on both `.90` images confirms the commit.
Everything committed **up to and including `aa13efe486`** is deployed, with the docs-only
commits that need no deploy.

**Above that line is empty.** `aa13efe486` is the tip of `arribada/main` on the remote;
nothing is committed ahead of what production serves. (The prior handover's "not built
nor deployed" list — the three-pass frontend `09115501c3`, its CI floor `7fbc60ae36`, and
the backend `external_edits` pass `aa13efe486` — all shipped in `.90`.)

| Commit       | Deployed?       | What                                                                                                                             |
| ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `aa13efe486` | **serving now** | Backend: wiki-sync `external_edits` flag + a filter so the sync finds its own writes. Migrations `0042` + `0043`.               |
| `7fbc60ae36` | yes             | CI: web floor 725, measured on the merged tree.                                                                                  |
| `09115501c3` | yes             | Frontend — timeline state groups, gestures and arrows (three passes, one commit).                                              |
| `05c24aacc4` | n/a — docs only | Recorded what `.89` served, and the grep that lies about RunPython.                                                              |
| `c77edfad9e` | yes             | CI: web suite under two non-UTC zones, `WEB_URL`, `freezegun`, measured floors (569 web / 580 backend). Was `.89`.               |
| `d830927388` | yes             | Frontend — nested timeline, colours, exports, and dates that mean one day. 110 files.                                            |
| `6448e35fd9` | yes             | Backend — plan governance, portfolio nesting, caller's-day dates. 30 files; migrations `0040` + `0041`.                          |
| `ac98514a4d` | yes             | Timeline refresh: the write landed, the screen kept the old answer (MobX/React memo staleness).                                  |
| `63c1896a20` | n/a — docs only | The handover named a commit production had not run for five deploys.                                                             |
| `a79290d0fe` | n/a — docs only | `ROLLBACK.md`. No image, nothing to ship.                                                                                        |
| `e75cd9a12f` | yes             | Celery ceiling + fencing-token lock; order tracking; three surfaces that lied to non-admins. Backend 432 → 468, web 121 → 151.   |
| `145ae6c08a` | yes             | The date bomb (two permanent-500 classes), four proven seq scans, the 84-query endpoint, migration `0039_roster_lookup_indexes`. |
| `6b3b8bcd5c` | yes             | Ops floors: cache `IGNORE_EXCEPTIONS`, socket timeouts, `CONN_MAX_AGE`, Celery retry/lock policy.                                |
| `170c639e7b` | yes             | Notifications (point 5). Backend 381 → 396, web 106.                                                                             |
| `0cbf11817e` | yes             | Money integrity (point 2), nine defects + migration `0038`. Backend 308 → 381, web 75 → 96.                                      |
| `f36ea2d9c7` | yes             | Permission-level class fixed (point 1). Backend tests 210 → 308.                                                                 |
| `876cc26b2c` | yes             | Silent-failure class fixed (point 3). Web tests 24 → 75.                                                                         |

`94f7adddea` — which an earlier version of this file named as production — is now
six deploys behind (production is `.90`). It survives on the droplet only as the rollback image
`arribada/plane-backend:rollback-94f7adddea`. See `ROLLBACK.md`, which is the
authority on what is on that disk and what is not.

The CI backend job now has a real Postgres service — before this, ~48 tests errored
on every run and the floor only counted collection. A security fix shipped with five
holes open under a green tick because of it.

## The repository

`github.com/arribada/plane` is a **public fork** of `makeplane/plane`. All our work —
227 commits as of today — lives on exactly one branch, **`arribada/main`**, which is
what production is built from. The other ~554 branches on the fork are inherited from
upstream and are the reference for future merges; leave them alone.

As of 2026-08-10 the fork's **default branch is `arribada/main`** (it was upstream's
`preview`). A fresh `git clone` therefore checks out our production branch, and new PRs
target it by default. `arribada/main` has **no branch protection** — nothing stops a
direct push or a force-push to the branch production is built from.

## Done — all of the below is in production

**Point 1 — permissions.** Rule: _a route that names a project decides on the caller's
role in that project._ 57 decorators moved to `level="PROJECT"`. Body-supplied project
ids scoped via a new `_writable_projects()`. Budget writes and `is_lead` changes are
lead-only. `budget_amount`/`budget_currency` are now `read_only_fields` on the
serializer and stripped from GET for non-`MONEY_ROLES`. Structural tests read the
decorator's **closure**, not the source, and sweep every routed handler.

**Point 3 — silent failures.** Root cause was in `arribada.service.ts`: 104 catches
rethrew `error?.response?.data`, which is `undefined` on a dropped connection and HTML
on a 502. One `rethrow` helper (`ce/services/api-error.ts`) now preserves status and an
offline flag. Dashboards distinguish failed from empty; the funder report refuses to
download when a money section fails; bulk operations report per-item outcomes.

**Point 2 — money integrity.** Closed by `0cbf11817e`. All nine defects listed as open
in the 2026-08-08 draft of this file are fixed: archived items no longer drop their cost;
one discipline per item, enforced on `issue` alone with existing rows collapsed by
migration `0038`; the `role=`/`roles` `FieldError` gone; Approve now reads inside its own
transaction under `select_for_update` with a `OneToOne` and an in-flight guard on the
button (`select_for_update` went from **0** occurrences in this fork to 8); the spend
curve is computed server-side, converted, labour included, omissions named; part-time
staffing writes `IssueEffort` instead of billing elapsed days; `budget_currency` converts
instead of relabelling; a non-EUR/GBP budget no longer reports the whole project as zero.
The point of the pass was the tests — `_labour_cost`, `_budget_display`, `_cost_by_cycle`
and `ProjectBudgetEndpoint` had none, and the two files that came near the area faked
their own subject. 41 backend and 16 web tests fail against the parent commit.

**The delete escalation — closed** in the same commit. `ProjectTeamEndpoint.put` was a
full replace (`.exclude(id__in=keep).delete()`), so a plain project MEMBER could delete
the whole roster by omission, destroying leave, working pattern and holiday calendar.
Removals must now be **named** in the payload and are the lead's — which also fixes the
stale-tab race that deleted whoever had been added since the page loaded.

**Point 5 — notifications.** See the Notifications section below. Done and deployed.

**Ops and performance.** `6b3b8bcd5c` gave five production defaults a floor (cache
`IGNORE_EXCEPTIONS` — a Valkey blip used to 500 the bootstrap request with Postgres
perfectly healthy; socket timeouts; `CONN_MAX_AGE` + `CONN_HEALTH_CHECKS` set together;
Celery retry policy and locking). `145ae6c08a` defused the date bomb — `working_days`
walked the calendar one day at a time, so one work item dated 9999-12-31 raised
`OverflowError` and 500'd every request **permanently**, including the screens that
would have shown you the row to correct. Now arithmetic, exact at every distance,
8 µs at year 9999. `e75cd9a12f` capped the Celery tasks (soft 1500 s / hard 1680 s, both
under RabbitMQ's 1800 s `consumer_timeout`, which was requeueing still-running tasks
under `acks_late`) and replaced the `finally`-released lock with a fencing token, so a
SIGKILLed worker's redelivery recognises its own dead predecessor instead of being
refused by our own lock.

## Not done — in priority order

### Point 4 — rendering and mobile — BLOCKED on a human

Needs a signed-in browser. `e2e/` harness is committed and works
(`pnpm install --ignore-workspace && pnpm exec playwright install chromium && pnpm auth
&& pnpm test`). `pnpm auth` opens Chromium and waits for a manual login to write
`.auth/storageState.json`. Nobody has ever opened this software in a browser — no drag
confirmed by a real mouse, no Finance page seen, no expense modal filled in.

### Notifications — DONE

Fixed in the notifications commit. Backend tests 381 → 396, web 106; both CI floors raised.

- Click guard split (`item.tsx`): selection and mark-read happen for every notification,
  only the peek still needs `data.issue.id`. `!projectId` dropped from the render guard,
  so both GitHub triage rows draw. `arribada-detail.tsx` now renders for the reminder
  and the digest (pinned in `root.test.tsx`).
- Reminder text is `Project · ARB-42 — overdue since 1 Aug (In progress)`; `data.issue`
  is populated (identifier/sequence_id/name/state_name, **no `id`** — an id would send
  the pane to upstream's peek instead of ours); `message_html` is now empty, which also
  removes the XSS at the old `reminder_task.py:85`.
- Forwarding chunks the window into 200-item POSTs (the dashboard's cap is exactly 200);
  `_plain_text` decodes before stripping; `_post` refuses redirects and requires https.
- Forwarded upstream activity is a real sentence built from `data.issue_activity`.
- The digest dedupes on the sender, not on its own count, and links to `/github-triage`.
- Both `message_html` writers escape user text (`django.utils.html.escape`).

**Still not built: web push.** There is none anywhere in either codebase — the service
worker is a dead `next-pwa` relic that is never registered. The Windows toasts are the
mail client (`email_notification_task`, every 5 min) and that link is correct. The fork's
own notifications never email, so the overdue reminder — the one most worth a toast —
still cannot raise one. Whether to build it is a product call.

### Other open items

- ~26 read handlers now answer 403 instead of 404 to a workspace admin outside a project.
  Frontend error handling should account for it.
- `ProjectTeamEndpoint.put` 500s when neither `APP_BASE_URL` nor `WEB_URL` is set
  (pre-existing, outside `plane.arribada`, set in production).
- Expenses cannot be edited, and `ProjectExpense` has no `updated_by`.
- Rates have no effective date — changing one silently re-prices history, including
  figures already sent to a funder.
- All five Home widgets ship enabled, contradicting their own comment.
- Everything defaults to EUR in a GBP organisation.
- ~40 hardcoded strings still say "cycle" after the Cycle→Sprint rename; the sign-in page
  says "Welcome back to Plane" and shows SSO as "Sign in with GitLab". **Re-verified
  2026-08-10**: `auth-header.tsx:31/35/39` and `hooks/oauth/core.tsx:66` still say both.
- Droplet was at 90% disk; 18 GB reclaimed, now 80%. Docker log rotation is configured but
  has never taken effect — the daemon has not reloaded since before the config was written.

Everything in this list except the two re-verified above was last checked **2026-08-08**
and has not been re-confirmed against the deployed commit. Treat it as a lead, not a fact.

### Order tracking — closed 2026-08-10

`trackPurchase` had zero call sites, so an approved purchase could never be marked ordered
or received, the decided list drew both states as "Rejected" in red in the list a grant
reviewer reads, and "wait for deliveries" could not do anything because auto-schedule
builds its floors from `expected_on`/`received_on`. Fixed in `e75cd9a12f`: the form exists
(`budget-block.tsx:396`), the two-way ternary is a lookup that cannot call a non-refusal a
refusal, and the status is derived from the dates rather than picked separately — the
scheduler reads the dates, so the dates are the fact.

## Traps that cost real time this week

- **A push does not build the frontend.** The `web` job is gated on `workflow_dispatch`
  with `build_web: true`. Judge the **web job's** conclusion, not the run's.
- **Building is not deploying.** Compose serves `makeplane/plane-*:v1.3.1`; re-tag and
  force-recreate or `docker ps` shows the right tag while serving old code.
- Compose lives at `/opt/arribada-platform/tools/docker-compose.plane.yml`. The one inside
  `/opt/plane-fork` is a decoy. On the droplet the fork remote is `arribada`, not `origin`.
- `.90` is deployed (= `aa13efe486`). Next tag should be `.91` or higher — but prefer the commit SHA:
  `TAG` now defaults to `github.sha`, and the numbered tags are not a history (`.77`–`.80`
  are all one image id). See `ROLLBACK.md`.
- **The droplet cannot pull from ghcr.** Its credential is a `gho_` OAuth token with no
  package scopes. The backend images _are_ in ghcr; the droplet just cannot read them, and
  builds locally instead. The frontend is not in ghcr at all — it is a 5-day CI artifact.
  `ROLLBACK.md` §0 has the detail; this is the single biggest gap in the recovery story.
- The frontend image is nginx serving a Vite build at `/usr/share/nginx/html/assets` —
  not Next.js.
- **Take grep markers from the actual diff.** Inventing plausible-sounding strings
  produced a false failure once; minified symbol names are not greppable, string literals
  are.
- `lint-staged` runs its own internal `git stash`. Never run `git stash` yourself — another
  agent may be in the tree.
- Prove a permission test **both ways**: a check that only proves denial passes on an
  endpoint that refuses everyone.
- **`oxlint --fix` is not safe to run in bulk.** `lint-staged` runs it, so a large
  commit invokes it over every staged file at once. Two of its autofixes are wrong
  in this repo: it rewrites `.sort()` into `.toSorted()`, which is ES2023 and does
  not compile against this workspace's lib (five files, and the codebase already
  carries half a dozen comments explaining exactly this); and it **deletes React
  dependencies it cannot see**, which in `portfolio/root.tsx` removed
  `ganttDisplay.showCompleted` from a dependency array whose own comment, two
  lines above, says it must be there. Neither is caught by tests — the first is a
  typecheck failure, the second is silent. Run `oxlint` WITHOUT `--fix` to see
  what is wrong, fix it by hand, and put an `oxlint-disable-next-line` (with the
  reason) on anything the rule is wrong about. Note the directive must be the LAST
  comment line before the code — a `-- reason` that wraps onto a second line
  silently does nothing.
- **Never `rm -rf` a directory that contains a Windows junction into this workspace.** A
  throwaway worktree or a scratch copy made with `mklink /J` (or `New-Item
-ItemType Junction`) looks like a directory to `rm`, which follows it and deletes the
  real files on the other side. This happened three times in one day: one agent lost
  **1242 tracked source files, twice**. Remove the junction first with `rmdir` (cmd) or
  `Remove-Item` on the link itself, verify with `dir /AL`, and only then delete the
  parent. `git worktree remove` is the safe way to drop a worktree.
- **`node_modules` is not reliable while another agent is working.** Concurrent
  `pnpm install`s tear it down: packages extract EMPTY (the directory and the symlink
  both exist, so nothing looks wrong) and `typescript` or
  `@atlaskit/pragmatic-drag-and-drop` vanish mid-run. It presents as a phantom `TS2307`
  in a file nobody touched, or as jsdom failing to boot with `Cannot find module
'@csstools/css-calc'` so that the whole web suite collects **zero** tests and says so
  quietly. Do not chase the bug: check the package directory is non-empty, then
  `Remove-Item -Recurse` the broken `.pnpm` entry and re-run `pnpm install
--frozen-lockfile` — a plain re-install will NOT repair it, because pnpm sees the
  directory and believes the package is already there.
- **`TZ=… <command>` does nothing from Git Bash on Windows**, and it fails as a FALSE
  GREEN. MSYS strips `TZ` when it spawns a native Windows process, so `process.env.TZ`
  arrives `undefined`, `vitest.config.ts`'s `??=` default takes over, and BOTH halves of
  the two-zone loop run under `America/Los_Angeles`. Turbo is then right to hash them
  the same, hits its cache on the second, and prints `FULL TURBO` in under a second —
  which looks like the cache doing its job and is really the eastern zone never
  executing. The tell is the replayed run reporting the SAME `Start at` timestamp and
  the same duration as the first. Nothing is wrong on CI, which is Linux. To check both
  zones on Windows use PowerShell, which does not strip it:
  `$env:TZ='Pacific/Auckland'; pnpm turbo run test --filter=web`. Confirm with
  `node -e "console.log(process.env.TZ)"` before trusting a two-zone result.
