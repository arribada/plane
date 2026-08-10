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

| Image                                                | Image id       | Commit                      | Notes                                                                                      |
| ---------------------------------------------------- | -------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `arribada/plane-backend:v1.3.1-arribada.88`          | `950d044e64c0` | `e75cd9a12f`                | **currently served** (= `makeplane/plane-backend:v1.3.1`), built 2026-08-10 07:10          |
| `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.88` | `d2afafdd41ad` | `e75cd9a12f`                | **currently served** (= `makeplane/plane-frontend:v1.3.1`), CI artifact of run 31364698124 |
| `arribada/plane-backend:v1.3.1-arribada.87`          | `59d2c947c519` | `170c639e7b`                | the previous serve; **the roll-forward/back target for this deploy**                       |
| `arribada/plane-frontend:v1.3.1-arribada.87`         | `7bbff227cf0b` | `170c639e7b`                | the previous serve; pair it with the backend above                                         |
| `arribada/plane-backend:rollback-94f7adddea`         | `0bc09cf9a567` | `94f7adddea`                | also tagged `v1.3.1-arribada.5`; **the rollback target**                                   |
| `arribada/plane-frontend:rollback-94f7adddea`        | `6a65bd4702e1` | `94f7adddea`                | also tagged `ghcr.io/arribada/plane-frontend:v1.3.1-arribada.85`                           |
| `arribada/plane-backend:rollback-20260730`           | `e2ce98341ca1` | (undated, pre-`94f7adddea`) | older escape hatch, provenance not recorded                                                |
| `arribada/plane-frontend:rollback-20260730`          | `a60822d87386` | (undated)                   | also tagged `v1.3.1-arribada.1`                                                            |

Why the numbered tags cannot be trusted as history: `v1.3.1-arribada.5` is dated 2026-08-05,
five days _after_ `.4`, and `.77`, `.78`, `.79` and `.80` are all the single image id
`9aac79315fc7`. The tag was a counter somebody typed, and CI's default overwrote `.1`
whenever anyone pushed. Go by image id.

> ### ⚠️ `ghcr.io/arribada/plane-backend` is EMPTY
>
> Every backend image listed above — including **both** rollback targets — exists only in
> this droplet's `/var/lib/docker`. CI builds the backend and its push step fails on a ghcr
> credential that 403s, which is why the deploy script explicitly judges the _web_ job's
> conclusion and ignores the run's. **If that disk is lost there is no rollback and no
> roll-forward, only a rebuild from source.** Fixing this means a working ghcr credential
> and letting the backend push succeed, exactly as the frontend already does. Until then,
> `docker save` the two rollback images somewhere off the droplet.

---

## 1. Decide: code only, or code **and** database?

> **2026-08-10.** `e75cd9a12f` is deployed and carries migration `0039_roster_lookup_indexes`.
> It is `AddIndex` only — no columns, no `RunPython`, nothing to undo badly — so rolling the
> code back to `.87` and leaving `0039` applied costs nothing at all. A pre-deploy dump was
> taken anyway and verified:
> `/opt/backups/archive/plane-db-predeploy-2026-08-10_070951.sql.gz` (gzip clean, ends with
> `PostgreSQL database dump complete`, 1,222,442 bytes compressed / 7,200,501 raw).

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
  that is retained for 5 days. Past that, rolling the frontend back means re-running the
  workflow at the old commit.
- **MinIO uploads** are backed up nightly and pre-deploy, but there is no procedure here for
  restoring a single asset — only the whole tarball.
- **`django_celery_beat`'s `PeriodicTask` rows** are written from `app.conf.beat_schedule` on
  beat start. Rolling code back rewrites them to the old schedule automatically; rolling
  forward does the same. Nothing to do, but do not be surprised to see the table change.
