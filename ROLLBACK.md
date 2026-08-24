# Rolling back plane.arribada.org

There was no rollback procedure. `grep -rn -i rollback` over this repository returned three
hits, none of them one. The two `rollback-*` images on the droplet are hand-made and
undocumented — genuine, but nobody except the person who tagged them could say what they
were, because **every backend image on that machine has `Labels: null`**.

This file is the procedure. Read the whole of §1 before touching anything: on this instance
a rollback of the code is not automatically a rollback of the database, and one of the two
directions is irreversible.

---

## 0. Facts you need before you start

|                |                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Host           | `157.245.42.241`, `plane.arribada.org`                                                                                               |
| Compose file   | `/opt/arribada-platform/tools/docker-compose.plane.yml` (the one inside `/opt/plane-fork` is a **decoy**)                            |
| Env file       | `/opt/arribada-platform/tools/.env.plane`                                                                                            |
| Fork checkout  | `/opt/plane-fork` — remote is `arribada`, **not** `origin` (`origin` is upstream makeplane)                                          |
| Served tags    | compose pins `makeplane/plane-backend:${PLANE_RELEASE}` and `makeplane/plane-frontend:${PLANE_RELEASE}`, with `PLANE_RELEASE=v1.3.1` |
| Backend build  | on the **droplet** (`/opt/plane-fork/build-be.sh`), not in CI                                                                        |
| Frontend build | in **CI**, `workflow_dispatch` with `build_web: true`, downloaded as a tar artifact                                                  |

**`docker ps` will not tell you what is running.** The fork's images are re-tagged
`makeplane/plane-*:v1.3.1`, so `docker ps` shows an upstream name for our code. Resolve the
image id instead:

```bash
docker inspect arribada-plane-api-1 --format '{{.Image}}'
docker images --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' | grep <that id>
```

From the next build onwards, `docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`
answers it directly — `.github/workflows/arribada-build.yml` now stamps the commit as an OCI
label, and `TAG` defaults to the commit SHA instead of overwriting `v1.3.1-arribada.1` on
every push.

### Which image is which commit

Labels only exist on images built after this change, so for anything older this table is the
record:

| Image                                                | Image id       | Commit                      | Notes                                                                                            |
| ---------------------------------------------------- | -------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.104`| `1e5230bfc1ad` | `2dda93197b`  | **currently served frontend** (= `makeplane/plane-frontend:v1.3.1`), Home my-tasks refresh (peek-close + button); CI artifact loaded 2026-08-19; **frontend roll-back target is `.103`** |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.103`| `79f576735eb5` | `dab8d3f293`  | previous frontend serve (**the roll-back target for `.104`**); calendar duration bars + collapsible portfolio controls; OCI revision label present |
| `arribada/plane-backend:31608607b1`                  | `41c2e1c34113` | `31608607b1`         | **currently served backend** (= `makeplane/plane-backend:v1.3.1`), MyWorkEndpoint start_date+state; built on the droplet 2026-08-19; OCI revision label present. **The `.90` image below is its rollback target.** |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.102`| `991cb8292461` | `3480aaf0d5`         | previous frontend serve; **the frontend roll-back target for the `.103` deploy**; drag-to-un-nest + in-dropdown create |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.101`| `b79573b3469b` | `cb28c2ed9f`                | previous serve; **the frontend roll-back target for the `.102` deploy**; milestone + auto-select + drag-to-nest |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.100`| `2a487692f76b` | `dfb55ab323`                | previous serve; **the frontend roll-back target for the `.101` deploy** (esp. if drag-to-nest misbehaves); inline sprint/module create |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.99` | (built, may be unloaded) | `6fea7ba658`       | Home my-tasks peek; the `.100` tree contains it, so `.100` was deployed directly |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.98` | (built, may be unloaded) | `ef58520e7a`       | discipline+effort at creation; contained in `.100` |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.97` | `70ae4ec9baeb` | `e34286014c`                | quick-add full-modal button; **the frontend roll-back target for the `.100` deploy** (last serve before it) |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.96` | `7c86b64a045d` | `dfe3b539bb`                | gantt status dot; older serve; OCI revision label present |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.95` | `61c7cb867329` | `8c73cb6ac8`                | login correction; older serve; OCI revision label present |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.94` | `9ade7a9552a4` | `e7ee0d36be`                | older frontend serve; OCI revision label present |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.93` | `cd36c65d2f45` | `06bf6626d0`                | older frontend serve; OCI revision label present |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.92` | `be1449169e9f` | `f8902dcd15`                | older frontend serve; OCI revision label present |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.91` | `d618eb235591` | `386e622001`                | older frontend serve; OCI revision label present |
| `arribada/plane-backend:v1.3.1-arribada.90`          | `6a0c7e1faffd` | `aa13efe486`                | **the backend roll-back target** (served `.90`→`.102`; superseded by `31608607b1` on 2026-08-19). Built on the droplet 2026-08-12 16:49. To roll the backend back: `docker tag 6a0c7e1faffd makeplane/plane-backend:v1.3.1` + recreate api/worker/beat |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.90` | `d37d47244cf4` | `aa13efe486`                | older frontend serve; OCI revision label present |
| `arribada/plane-backend:v1.3.1-arribada.89`          | `7d7b3e85559a` | `c77edfad9e`                | older backend serve, built on the droplet 2026-08-12 10:45 |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.89` | `976196a923c8` | `c77edfad9e`                | the previous serve; pair with the backend above; CI artifact of run 31588685459 (past its 5-day window — may be gone) |
| `arribada/plane-backend:v1.3.1-arribada.88`          | `950d044e64c0` | `e75cd9a12f`                | one before that, built 2026-08-10 07:10                                                          |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.88` | `d2afafdd41ad` | `e75cd9a12f`                | one before that; pair it with the backend above                                                 |
| `arribada/plane-backend:v1.3.1-arribada.87`          | `59d2c947c519` | `170c639e7b`                | one before that                                                                                  |
| `arribada/plane-frontend:v1.3.1-arribada.87`         | `7bbff227cf0b` | `170c639e7b`                | one before that; pair it with the backend above                                                  |
| `arribada/plane-backend:rollback-94f7adddea`         | `0bc09cf9a567` | `94f7adddea`                | also tagged `v1.3.1-arribada.5`; **the rollback target**                                         |
| `arribada/plane-frontend:rollback-94f7adddea`        | `6a65bd4702e1` | `94f7adddea`                | also tagged `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.85`                                 |
| `arribada/plane-backend:rollback-20260730`           | `e2ce98341ca1` | (undated, pre-`94f7adddea`) | older escape hatch, provenance not recorded                                                      |
| `arribada/plane-frontend:rollback-20260730`          | `a60822d87386` | (undated)                   | also tagged `v1.3.1-arribada.1`                                                                  |

Why the numbered tags cannot be trusted as history: `v1.3.1-arribada.5` is dated 2026-08-05,
five days _after_ `.4`, and `.77`, `.78`, `.79` and `.80` are all the single image id
`9aac79315fc7`. The tag was a counter somebody typed, and CI's default overwrote `.1`
whenever anyone pushed. Go by image id.

> ### ⚠️ The registry story — corrected 2026-08-10
>
> An earlier version of this file said **`ghcr.io/arribada/plane-backend` is EMPTY** and
> that the backend's push step "fails on a ghcr credential that 403s". **Both claims are
> wrong**, and believing them during an incident would send you to rebuild from source
> when a good image was one `docker pull` away. What is actually true:
>
> **The backend IS in ghcr — roughly 49 tags, including the one serving production.**
> `.github/workflows/arribada-build.yml` pushes it on every push to `arribada/main`:
> the "Push image" step is `docker/build-push-action@v6` with `push: true` and
> `tags: ghcr.io/arribada/plane-backend:${TAG}`. Proven from the CI job logs, not
> inferred. The push succeeds; nothing 403s in CI, which authenticates with the job's
> own `secrets.GITHUB_TOKEN`.
>
> **The real problem is that the droplet cannot READ ghcr.** Its credential is a `gho_`
> OAuth token carrying `gist, repo, workflow` and **no package scopes at all**. Reproduce
> it from anywhere holding that token:
>
> ```bash
> curl -s -H "Authorization: Bearer $TOKEN" \
>   https://api.github.com/orgs/arribada/packages/container/plane-backend/versions
> # {"message":"You need at least read:packages scope to get a package's versions.", ... 403}
> ```
>
> That is why the backend is built **on the droplet** rather than pulled, and why the
> deploy path never depends on a registry read. It is a missing-scope problem, not a
> missing-image problem. **Fix: issue a token with `read:packages`** (a PAT or a
> fine-grained token with package read on the org) and `docker login ghcr.io` with it —
> then every backend rollback target becomes pullable and the droplet's disk stops being
> the only copy.
>
> **The FRONTEND is the genuine gap.** It stopped being pushed to ghcr on **2026-07-18**
> (`c233e5874e`, then `850fa62bca`). The `web` job now builds with
> `outputs: type=docker,dest=/tmp/frontend-image.tar` and uploads the gzipped tar via
> `actions/upload-artifact` with **`retention-days: 5`** — it never pushes. The ghcr-style
> name in the table above (`ghcr.io/arribada/plane-frontend:v1.3.1-arribada.88`) is only
> the tag baked _inside_ that tar; **there is no such image in the registry**. So a
> frontend older than five days exists **only** in this droplet's `/var/lib/docker`, and
> past that window rolling the frontend back means re-running the workflow at the old
> commit. Until the frontend is pushed again, `docker save` the frontend rollback images
> somewhere off the droplet.
>
> **`/opt/plane-fork/build-be.sh` on the droplet repeats the same disproven claim** in its
> comments. It cannot be edited from the repository — fix it in place on the droplet, or
> trust this file over it. Any `ghcr.io/...` name in the table below is the tag baked into
> a local image; for the frontend it does **not** imply a registry copy.

> ### ⚠️ There are no DigitalOcean droplet backups
>
> Droplet backups are **deliberately not enabled** on `157.245.42.241`. Nothing snapshots
> this machine. `/opt/backups/images/` — and every pre-deploy dump in
> `/opt/backups/archive` — sits on the **same disk as the data it protects**, so a disk or
> droplet loss takes the database, the uploads, the images and the backups together.
>
> **A monthly manual download to a workstation is the only off-machine copy.** It is not
> automated and nothing will remind you. Pull at minimum the newest pre-deploy dump, the
> matching uploads tarball, and a `docker save` of the current + rollback images.

---

## 1. Decide: code only, or code **and** database?

> **2026-08-18 (frontend `.100`).** Current serve `.100` = `dfb55ab323` (inline sprint/module
> create). `.97`–`.100` (quick-add full-modal button, discipline+effort at creation, Home
> my-tasks peek, inline create) shipped in one deploy of `.100`, whose tree contains them;
> `.98`/`.99` were never served alone, so the roll-back target is **`.97`** = `70ae4ec9baeb`.
> All frontend-only, **no migrations**. Backend still `.90`.
>
> **2026-08-18 (frontend `.96`).** Current frontend serve is `.96` = `dfe3b539bb` (gantt
> status dot). `.95` = `8c73cb6ac8` (login correction: the "GitLab" button IS the Arribada
> dashboard SSO — restored + rebranded, GitHub/Gitea buttons dropped). `.94` = `e7ee0d36be`
> (expense editing, currency default, mobile pass 2). All three are frontend-only, **no
> migrations**. Rollback is pure `docker tag <target-id> makeplane/plane-frontend:v1.3.1` +
> `--force-recreate web`; targets in the table above. Backend still the `.90` image.
>
> **2026-08-18 (frontend `.93`).** `.93` = `06bf6626d0` (safe responsive pass, frontend-only).
>
> **2026-08-17 (frontend `.92`).** The frontend serve `.92` = `f8902dcd15`
> (the bottom-right build-version badge). `.91` = `386e622001` was the home-quickstart link
> fix. Both are frontend-only and carry **no migrations** — a `.92 → .91` (or `→ .90`)
> frontend rollback is pure `docker tag` + `--force-recreate web`, no DB action. The backend
> was not rebuilt for either and remains the `.90` image; the migration notes below (for
> `aa13efe486`) still describe the deployed backend.
>
> **2026-08-17 (reconciled).** Backend `aa13efe486` carries **two**
> migrations on top of `.89`: `0042` and `0043`. **Both are safe to strand on a rollback and
> neither needed a pre-deploy dump** — read them, do not grep them (`grep -l RunPython` over
> these two files gives a FALSE positive, matching the word in each docstring's prose; there
> is no `RunPython` in either).
>
> - `0042_project_schedule_external_edits` — `AddField`, a boolean `external_edits`
>   `default=False`. Schema only, reversible, safe to strand. Rolling code back to `.89`
>   just drops the answer to a question `.89`'s code never asks.
> - `0043_issue_external_source_index` — `RunSQL` `CREATE INDEX CONCURRENTLY` (partial, on
>   `issues (project_id, external_source) WHERE external_source IS NOT NULL`), `atomic=False`.
>   Reversible via `DROP INDEX CONCURRENTLY`; leaving it applied under `.89` costs nothing.
>   If ever reported failed, check for an INVALID index and drop it (see §2's index query).
>
> So a `.90 → .89` code rollback needs **no** database action. `git diff --name-only
> c77edfad9e..aa13efe486 -- apps/api/plane/arribada/migrations/` lists `0042`+`0043`; both
> are schema/DDL only.

> **2026-08-12.** `c77edfad9e` (`.89`) carries **two** migrations, `0040` and `0041`.
>
> - `0040_project_schedule_lead_only_edits` — `AddField`, a boolean with `default=False`.
>   Schema only; safe to strand.
> - `0041_project_wiki_doc_drive_links` — `AddField` **plus a `RunPython`** that copies each
>   existing `google_drive_url` into the new `google_drive_links` list. Unlike `0038` and
>   `0014` this one has a **real reverse** (`list_to_single`), which rewrites
>   `google_drive_url` from `links[0]["url"]`. The stated caveat is that reversing a row
>   that has since gained a SECOND link keeps the first and drops the rest — a `CharField`
>   cannot hold three URLs.
>
> So rolling the code back to `.88` and leaving both applied is safe: `google_drive_url` is
> never dropped, it is kept as a derived mirror, and `.88`'s code still reads it.
>
> Measured on production at the moment of the deploy: 22 `arribada_project_wiki_doc` rows,
> 9 with a non-empty `google_drive_url`, 9 with links afterwards, **0** rows where
> `links[0].url` disagreed with the column. All 6 `arribada_project_schedule` rows took
> `lead_only_edits = false`, so nobody lost the timeline at the moment the image rolled.
>
> Pre-deploy dump, taken and verified before migrating:
> `/opt/backups/archive/plane-db-predeploy-2026-08-12_104407.sql.gz` — `gzip -t` clean, ends
> with `PostgreSQL database dump complete`, 1,232,152 bytes compressed / 7,252,433 raw,
> md5 `0f5b85b15ffde41481ca505ea5109e1e`, and both affected tables present in it.
>
> ⚠️ **The §5 recipe below has a trap this deploy walked into.** `git diff --name-only
<old>..<new> -- .../migrations/ | xargs -r grep -l RunPython` greps the **working tree**,
> so if `/opt/plane-fork` is still checked out at the OLD commit the new migration files do
> not exist yet and the grep finds nothing — it reports "no RunPython" for a deploy that has
> one. Either check out the new commit first, or read the file out of the object database:
> `git show <new>:<path> | grep -q RunPython`.

Run this against the commit that is actually deployed:

```bash
cd /opt/plane-fork
git diff --name-only <target-sha>..<deployed-sha> -- apps/api/plane/arribada/migrations/
```

If that is empty, you are in the easy case — skip to §2.

If it is not empty, the question is what those migrations _did_. A schema-only migration
(`AddField`, `AddIndex`) is reversible and harmless to leave applied. A `RunPython` may not
be:

```bash
git diff --name-only <target>..<deployed> -- apps/api/plane/arribada/migrations/ \
  | xargs -r grep -l RunPython
```

### The state as of 2026-08-08

Rolling back to `94f7adddea` leaves **exactly one** migration applied ahead of the code:
`0038_one_discipline_one_expense`, applied 2026-08-08 09:28:36 UTC. `94f7adddea` contains
migrations up to `0037`; `0038` arrived with `0cbf11817e`.

**Leave `0038` applied.** Do not reverse it. Its `RunPython`s reverse to a documented `noop`:

> _"Backwards: the constraints come off, and neither deletion can be undone."_

So `migrate arribada 0037` drops the unique indexes and gives nothing back — you would lose
the constraint and keep none of the data. There is nothing to gain and a guarantee to lose.

**Code-back / DB-forward is survivable, and lossy in one specific way.** `0038` replaced
`UNIQUE(issue, role)` on `arribada_issue_role` with `UNIQUE(issue)`. The code at
`94f7adddea` writes disciplines with
`IssueRole.objects.bulk_create(new_roles, batch_size=100, ignore_conflicts=True)`
(`views.py:3599` and `:4383` at that commit), having filtered only against roles the issue
_already has by name_. Under the old two-column index that legitimately added a **second,
different** discipline to a work item. Under `UNIQUE(issue)` the same insert conflicts on
`issue` alone, and `ignore_conflicts=True` swallows it: **the write silently does nothing and
the endpoint still reports success.**

Concretely, while rolled back: applying an assistant plan, or the blueprint that creates work
items, cannot give a discipline to a work item that already has one. It will not error. It
will not warn. Nothing else in `0038` bites — nothing on this instance ever held two
disciplines for one issue (verified: 110 rows, 110 distinct `issue_id`, in the pre-migration
dump, and the same 110 ids live afterwards, so `keep_one_discipline` deleted nothing here).

**If you must also restore the database**, see §4. It is a destructive, whole-database
restore; there is no partial path.

---

## 2. Roll the code back

Nothing below rebuilds anything — both images are already on the disk.

```bash
cd /opt/arribada-platform/tools

# 1. Record what is running now, so you can go forward again.
docker inspect arribada-plane-api-1 --format '{{.Image}}'
docker inspect arribada-plane-web-1 --format '{{.Image}}'

# 2. Point the served tags at the rollback images. Compose serves the makeplane/* names;
#    re-tagging is the whole mechanism. Skip this and `docker ps` shows the tag you expect
#    while serving the code you are trying to escape.
docker tag arribada/plane-backend:rollback-94f7adddea  makeplane/plane-backend:v1.3.1
docker tag arribada/plane-frontend:rollback-94f7adddea makeplane/plane-frontend:v1.3.1

# 3. Recreate. --force-recreate is required: without it compose sees no change in the
#    compose file and does nothing at all.
docker compose -f docker-compose.plane.yml --env-file .env.plane \
  up -d --force-recreate --no-deps web api worker beat-worker

# 4. Verify — the image ids must now be the rollback ones, not the ones from step 1.
docker inspect arribada-plane-api-1 --format '{{.Image}}'
curl -s -o /dev/null -w '%{http_code}\n' https://plane.arribada.org/api/instances/
```

The `migrator` service is deliberately **not** in that list. It runs `migrate` on start; with
older code and a newer database it has nothing to do, but there is no reason to start it.

### Verify by observation, not by the tag

```bash
# a string that exists only in the version you rolled AWAY from must now be absent
docker exec arribada-plane-web-1 sh -lc \
  'grep -rl "<a literal string from the new build>" /usr/share/nginx/html/assets | wc -l'
```

Take that string **from the actual diff**. Inventing a plausible-sounding one has produced a
false "it worked" here before, and minified symbol names are not greppable — string literals
are.

### Uptime-Kuma

Monitor 4 is `https://plane.arribada.org/api/instances/` with the keyword
`"is_setup_done":true`, and monitor 8 (`plane stack`) is fed every 10 minutes by
`/root/uptime-kuma/ping-plane.sh`. Both should stay green throughout; monitor 4 will blip
DOWN for the recreation window, which is correct and is the point — the old monitor requested
the static SPA shell and reported `200 - OK` straight through a 48-second API outage on
2026-08-08.

---

## 3. Roll forward again

Exactly §2 with the image ids you recorded in step 1:

```bash
docker tag <recorded backend image id>  makeplane/plane-backend:v1.3.1
docker tag <recorded frontend image id> makeplane/plane-frontend:v1.3.1
docker compose -f docker-compose.plane.yml --env-file .env.plane \
  up -d --force-recreate --no-deps web api worker beat-worker
```

If the forward code needs migrations the database does not have, start `migrator` too, and
take a dump first (§5).

---

## 4. Restoring the database (last resort)

This replaces the **whole** database. Every change made since the dump is gone — including
anything users did between the dump and now. Do not do this to undo one migration.

```bash
# 1. Stop everything that writes, or the restore fights live traffic.
cd /opt/arribada-platform/tools
docker compose -f docker-compose.plane.yml --env-file .env.plane stop api worker beat-worker live

# 2. Dump what you are about to destroy. You will want it.
/opt/arribada-platform/tools/plane-predeploy-dump.sh before-restore

# 3. Restore. pg_dump output from this instance is plain SQL with CREATE/COPY, so it needs a
#    clean database to land in.
docker exec arribada-plane-plane-db-1 sh -c \
  'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d postgres \
     -c "DROP DATABASE $POSTGRES_DB WITH (FORCE)" -c "CREATE DATABASE $POSTGRES_DB"'
zcat /opt/backups/archive/plane-db-predeploy-2026-08-08_090518.sql.gz \
  | docker exec -i arribada-plane-plane-db-1 sh -c \
      'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB'

# 4. Start back up, with the code that matches that database.
docker compose -f docker-compose.plane.yml --env-file .env.plane start api worker beat-worker live
```

Uploads are separate — they live in MinIO, not Postgres. The matching
`plane-uploads-predeploy-*.tar.gz` sits next to the dump in `/opt/backups/archive`.

---

## 5. Before every deploy that carries a `RunPython` migration

**Run this. It is not optional.**

```bash
/opt/arribada-platform/tools/plane-predeploy-dump.sh
```

It dumps, checks the archive is non-trivial, checks `gzip -t`, checks for pg_dump's
`PostgreSQL database dump complete` marker (a truncated dump passes `gzip -t` quite happily),
and only then gives the file its final name. It writes to `/opt/backups/archive`, which the
nightly rotation never touches — `backup-tools.sh` walks `/opt/backups/tools` at
`-maxdepth 1` only.

How to know a deploy needs it:

```bash
cd /opt/plane-fork
git diff --name-only <deployed-sha>..<new-sha> -- apps/api/plane/arribada/migrations/ \
  | xargs -r grep -l RunPython
```

Any output at all means the deploy can destroy data that `migrate <previous>` will not give
back.

### The two migrations this rule exists for

- **`0038_one_discipline_one_expense`** — `keep_one_discipline` deletes `IssueRole` rows;
  `unlink_shared_expenses` nulls `ProcurementRequest.expense`. Reverse is `noop`, and the
  file says so. Applied on production 2026-08-08 09:28:36 UTC. The only dump from before it
  is
  `/opt/backups/archive/plane-db-predeploy-2026-08-08_090518.sql.gz`, taken 23 minutes
  earlier and now held outside the 14-day rotation. Verified: `gzip -t` clean, ends with
  `PostgreSQL database dump complete`, 7,187,989 bytes raw, md5 identical to the original.
  (It turned out to have cost nothing — 110 `IssueRole` rows before, the same 110 ids after
  — but that was luck, not design.)

- **`0014_merge_project_lead_role`** — ⚠️ **same irreversible shape, and there is no dump
  from before it.** `merge_backward` is `pass`; forward it rewrites
  `ProjectTeamMember.roles` in place and deletes `IssueRole` rows whose role collides after
  the rename. It has been in production since long before any of this, so which rows used to
  say "project lead" is simply not recorded anywhere. **Do not try to fix it** — there is
  nothing to reconstruct from. It is listed here so nobody plans a rollback that assumes it
  can be undone.

`0013_wiki_workspace_default` and `0023_versioned_baselines` also contain `RunPython`, but
both pass a real reverse function (`unrepoint`, `drop_carried_baselines`) rather than a
no-op.

---

## 6. What still has no rollback

- **The frontend build is not reproducible from the droplet.** It comes from a CI artifact
  that is retained for 5 days, and since 2026-07-18 it is **not pushed to ghcr at all**.
  Past that window, rolling the frontend back means re-running the workflow at the old
  commit — a 30–40 minute build, during an incident. This is the worst remaining gap.
- **The droplet's own copy is the only copy of anything it holds.** DigitalOcean droplet
  backups are deliberately off and `/opt/backups/` is on the same disk as the data (see §0).
  The backend rollback images are recoverable from ghcr _once a `read:packages` credential
  exists_; today the droplet cannot pull them.
- **MinIO uploads** are backed up nightly and pre-deploy, but there is no procedure here for
  restoring a single asset — only the whole tarball.
- **`django_celery_beat`'s `PeriodicTask` rows** are written from `app.conf.beat_schedule` on
  beat start. Rolling code back rewrites them to the old schedule automatically; rolling
  forward does the same. Nothing to do, but do not be surprised to see the table change.
