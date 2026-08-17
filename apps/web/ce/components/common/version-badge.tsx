/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// ABOUTME: A tiny, always-on build-version badge pinned to the bottom-right corner, so a
// ABOUTME: hard refresh can be confirmed visually and each deploy tracked at a glance.

// Injected at build time via VITE_* build-args — see apps/web/Dockerfile.web and the `web`
// job in .github/workflows/arribada-build.yml. vite.config.ts exposes `process.env` limited
// to the VITE_ prefix (that is why these read off process.env, not import.meta.env). They are
// resolved to string literals at build time, so this renders identically on server and client
// and cannot cause a hydration mismatch.
const VERSION = process.env.VITE_APP_VERSION || "";
const COMMIT = process.env.VITE_APP_COMMIT || "";
const BUILT = process.env.VITE_APP_BUILD_TIME || "";

export function VersionBadge() {
  const shortCommit = COMMIT ? COMMIT.slice(0, 8) : "";
  // Prefer the release tag; append the short commit whenever we have both. Falls back to
  // whichever one exists so a build that passed only a SHA still shows something.
  const label = VERSION && shortCommit ? `${VERSION} · ${shortCommit}` : VERSION || shortCommit;
  // Nothing to show (e.g. a local dev build with no args) — render nothing rather than "unknown".
  if (!label) return null;

  const title = [VERSION && `version ${VERSION}`, COMMIT && `commit ${COMMIT}`, BUILT && `built ${BUILT}`]
    .filter(Boolean)
    .join(" · ");

  return (
    // pointer-events-none guarantees the badge can never sit over and swallow a click on the
    // app underneath, whatever corner widget lands there. It is decorative, hence aria-hidden.
    <div
      aria-hidden
      title={title}
      className="pointer-events-none fixed bottom-1 right-2 z-40 select-none font-mono text-[10px] leading-none text-tertiary opacity-50"
    >
      {label}
    </div>
  );
}

export default VersionBadge;
