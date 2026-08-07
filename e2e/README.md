# Browser harness

Real-Chromium checks for the Arribada fork's own surfaces, run against a **live deployment**
(production by default). Everything upstream Plane already tests is out of scope; this suite
exists because every feature in `ARRIBADA.md` was verified by probes, typechecks and unit tests
and never by opening it.

It is deliberately **not** part of the pnpm workspace — `pnpm-workspace.yaml` globs `apps/*`
and `packages/*` only, so this directory installs on its own and cannot drag Playwright into
the web build.

## Run it

```sh
cd e2e
pnpm install --ignore-workspace
pnpm exec playwright install chromium

pnpm auth          # opens a real browser; log in once (SSO included), press Enter
pnpm test          # headless
pnpm test:headed   # watch it
pnpm test:ui       # Playwright's picker
pnpm report        # last HTML report
```

`pnpm auth` writes `.auth/storageState.json`. That file is a live session — it is
git-ignored and must stay that way. The script never reads, types or stores a password;
you log in yourself in the window it opens.

Point it somewhere else with env vars:

| Variable               | Default                      |
| ---------------------- | ---------------------------- |
| `PLANE_BASE_URL`       | `https://plane.arribada.org` |
| `PLANE_CHROME_CHANNEL` | bundled Chromium             |

`PLANE_CHROME_CHANNEL=chrome` uses the real installed Chrome instead of Playwright's build —
worth doing once before a release, because the drag-and-drop in the folder tree is native
HTML5 DnD and its behaviour is browser-specific.

## Rules this suite follows, and any new test must too

- **Read-only by default.** Prefer asserting on data that is already there.
- Anything that must write goes into a scratch object named `ZZ-E2E-…` and is removed in
  `afterAll`. `SCRATCH_PROJECT_NAME` and `PROTECTED_PROJECT_HINTS` in `tests/support.ts` name
  what is live team data.
- **Never delete what the suite did not create.**
- `workers: 1`. Production is shared and rate-limited; parallel runs make failures unreadable
  and the writes race each other.

## What is here

| File                                   | Covers                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tests/00-surfaces.spec.ts`            | every fork route loads, no 5xx, no raw `t()` keys on screen                                                           |
| `tests/01-sidebar-folders.spec.ts`     | folder create/nest, a **real-mouse** drag of a project onto a nested folder, persistence across reload                |
| `tests/02-finance-consistency.spec.ts` | the money invariants: sprint rows sum to committed, labour+planned+actual = committed, amount − committed = remaining |

## Things that bite

- **No `data-testid` anywhere in the fork's components.** Select by `aria-label`, `title`,
  role name or text. `tests/support.ts` has the two selectors worth sharing.
- **The folder tree is native HTML5 drag**, not `@atlaskit/pragmatic-drag-and-drop` like the
  rest of Plane's sidebar, and it reads its payload from a React ref set in `onDragStart` —
  a synthesised `drop` event with no real `dragstart` resolves to nothing and fails silently.
  Use `realMouseDrag()`, which crosses the drag threshold before moving.
- **Folders, saved orders and checklists use `window.prompt` / `window.confirm`**, not modals.
  Register `page.on("dialog", …)` _before_ the click or Playwright auto-dismisses and the
  action silently no-ops.
- **Row action buttons are `opacity-0` until hover.** They are in the DOM and "visible" to
  Playwright, so `hover()` the row first or you will click the wrong thing.
- Folders start **collapsed** on every load; expand before looking for project rows.
- Assert on the network round trip (`waitForResponse`) as well as the DOM. Several of these
  features have shipped with an optimistic UI over a request that 400s.
