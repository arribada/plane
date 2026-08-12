/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Component tests for the web app.
 *
 * Separate from `vite.config.ts` on purpose: that one runs the `reactRouter()`
 * plugin, which owns routing, SSR entry points and a typegen step, and none of
 * that has any business booting for a test that renders one dialog. Vitest picks
 * this file up ahead of vite.config.ts by name.
 *
 * The aliases are written out rather than read from tsconfig via
 * `vite-tsconfig-paths`, because `@/plane-web/*` maps into `ce/*` in this fork
 * (the edition swap upstream does at build time) and getting that wrong fails as
 * an unresolved import halfway down a stack trace. Order matters: vite matches a
 * string alias by prefix and takes the first hit, so every `@/<something>/`
 * mapping has to come before the bare `@/`.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Pin the clock's ZONE before anything imports a module that touches `Date`.
 *
 * Left alone, a test run inherits the machine's zone: UTC on every CI runner. UTC
 * is the single offset at which almost none of this app's date bugs reproduce —
 * every `toISOString().slice(0,10)` agrees with the local calendar, every
 * `Math.floor` over a day boundary lands on a whole number, and a suite that goes
 * green there is asserting nothing about the people who actually use the software.
 *
 * Set here, in module scope, rather than in `vitest.setup.ts`: this file is
 * evaluated in the main process before any worker is forked, so the workers
 * inherit it, and it lands ahead of any module-level `new Date()` in a file under
 * test. Assigning `process.env.TZ` at runtime does re-arm V8's timezone cache on
 * every platform this repo is developed on, Windows included.
 *
 * `??=`, not `=`: CI overrides it per run — see the two-zone loop in
 * `.github/workflows/arribada-build.yml`. The default is deliberately WESTERN, so
 * a developer running the suite locally sees what a reader in California sees.
 */
process.env.TZ ??= "America/Los_Angeles";

export default defineConfig({
  // The repo's tsconfig already says `react-jsx`; stated here too so a test does
  // not depend on which tsconfig vitest happens to discover from its own cwd.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Plain strings, not regexes: rollup's alias plugin matches a string prefix
    // on a path SEGMENT and rejoins the rest itself, which is the difference
    // between `ce/components/…` and `cecomponents/…` on a machine whose
    // path.resolve hands back backslashes.
    alias: [
      { find: "@/plane-web", replacement: path.resolve(__dirname, "ce") },
      { find: "@/app", replacement: path.resolve(__dirname, "app") },
      { find: "@/helpers", replacement: path.resolve(__dirname, "helpers") },
      { find: "@/styles", replacement: path.resolve(__dirname, "styles") },
      { find: "@", replacement: path.resolve(__dirname, "core") },
      // The same Next.js shims vite.config.ts installs. Components under test
      // import `next/link` and there is no Next.js in this repo to resolve it.
      { find: "next/link", replacement: path.resolve(__dirname, "app/compat/next/link.tsx") },
      { find: "next/navigation", replacement: path.resolve(__dirname, "app/compat/next/navigation.ts") },
      { find: "next/script", replacement: path.resolve(__dirname, "app/compat/next/script.tsx") },
    ],
    // Two copies of React in one process is a hooks crash, and the workspace
    // packages carry their own.
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    // Colocated with what they test. Scoped to the source folders so nothing in
    // build/ or .react-router/ is ever collected.
    include: ["{app,ce,core,helpers}/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
