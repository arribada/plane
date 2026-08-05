/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Everything every component test in this app gets for free.
 *
 * The jest-dom import is the `/vitest` entry point specifically: it registers the
 * matchers AND augments vitest's own `Assertion` type, so `toHaveFocus()` is both
 * available at runtime and known to `tsc --noEmit`, which runs over this file.
 */
// eslint-disable-next-line import/no-unassigned-import -- registering matchers is the entire point
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount between tests. These are focus tests and focus is global state — a
// panel left mounted by the previous test still answers the next one's Escape.
afterEach(() => {
  cleanup();
});
