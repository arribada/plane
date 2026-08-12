/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The gantt's display preferences: what is remembered, per whom, and what a drag
 * does to the grouping.
 *
 * The store is a module singleton that reads localStorage when it is constructed,
 * so every test here re-imports it under `vi.resetModules()`. That is not
 * ceremony — the construction-time read IS the behaviour being tested, because
 * doing it in an effect would paint one frame of the previous workspace's
 * grouping first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const LEGACY_KEY = "arribada.gantt.display";

/** A fresh store, as if the page had just been opened at `path`. */
const loadStore = async (path: string) => {
  vi.resetModules();
  window.history.replaceState({}, "", path);
  const module = await import("./gantt-display");
  return module.ganttDisplay;
};

beforeEach(() => {
  localStorage.clear();
});

describe("sub-task nesting preference", () => {
  it("is on by default, so an unconfigured chart nests", async () => {
    // The user asked for it checked by default; unticking gives back the flat
    // list this chart drew before.
    const store = await loadStore("/acme/projects/p1/issues");
    expect(store.nestSubtasks).toBe(true);
  });

  it("survives a reload once it has been switched off", async () => {
    const first = await loadStore("/acme/projects/p1/issues");
    first.setNestSubtasks(false);

    const second = await loadStore("/acme/projects/p1/issues");
    expect(second.nestSubtasks).toBe(false);
  });

  it("drops the folds when nesting is switched off, so none survive to hide a row", async () => {
    const store = await loadStore("/acme/projects/p1/issues");
    store.toggleSubtaskCollapsed("parent-1");
    expect(store.collapsedSubtasks.has("parent-1")).toBe(true);

    store.setNestSubtasks(false);
    expect(store.collapsedSubtasks.size).toBe(0);
  });
});

describe("the preferences are per workspace", () => {
  it("does not carry one workspace's grouping into another", async () => {
    const acme = await loadStore("/acme/projects/p1/issues");
    acme.setGroupBy("module");
    acme.setNestSubtasks(false);

    // Same browser, same person, a different workspace: grouping a hardware
    // programme by module has nothing to say about anyone else's board.
    const other = await loadStore("/beta/projects/p9/issues");
    expect(other.groupBy).toBe("none");
    expect(other.nestSubtasks).toBe(true);
  });

  it("keeps each workspace's own answer across a reload", async () => {
    const acme = await loadStore("/acme/projects/p1/issues");
    acme.setGroupBy("module");
    const beta = await loadStore("/beta/projects/p9/issues");
    beta.setGroupBy("priority");

    expect((await loadStore("/acme/projects/p1/issues")).groupBy).toBe("module");
    expect((await loadStore("/beta/projects/p9/issues")).groupBy).toBe("priority");
  });

  it("inherits the old unscoped key once, rather than resetting somebody's setup", async () => {
    // The key was global before this change and people already have one.
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ groupBy: "cycle", colorBy: "priority" }));

    const store = await loadStore("/acme/projects/p1/issues");
    expect(store.groupBy).toBe("cycle");
    expect(store.colorBy).toBe("priority");
  });

  it("stops tracking the old key as soon as anything is written", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ groupBy: "cycle" }));
    const store = await loadStore("/acme/projects/p1/issues");
    store.setGroupBy("label");

    expect(JSON.parse(localStorage.getItem(LEGACY_KEY) as string).groupBy).toBe("cycle");
    expect(JSON.parse(localStorage.getItem(`${LEGACY_KEY}:acme`) as string).groupBy).toBe("label");
  });

  it("follows a client-side navigation between workspaces", async () => {
    const store = await loadStore("/acme/projects/p1/issues");
    store.setGroupBy("module");
    store.toggleGroupCollapsed("some-module-id");

    store.setScope("beta");
    expect(store.groupBy).toBe("none");
    // A fold names a key from the workspace being left behind.
    expect(store.collapsedGroups.size).toBe(0);
  });
});

describe("a drag consumes the grouping", () => {
  it("drops the bands and records where the order came from", async () => {
    const store = await loadStore("/acme/projects/p1/issues");
    store.setGroupBy("module");

    store.flattenGrouping("module");

    expect(store.groupBy).toBe("none");
    // The toolbar reads this to say "Manual (from Module)" — the difference
    // between a grouping that was consumed and one that vanished.
    expect(store.flattenedFrom).toBe("module");
  });

  it("stops saying so the moment a grouping is picked by hand again", async () => {
    const store = await loadStore("/acme/projects/p1/issues");
    store.setGroupBy("module");
    store.flattenGrouping("module");

    store.setGroupBy("module");
    expect(store.flattenedFrom).toBeNull();
    expect(store.groupBy).toBe("module");
  });

  it("is a no-op when there were no bands to consume", async () => {
    const store = await loadStore("/acme/projects/p1/issues");
    store.flattenGrouping("none");

    expect(store.flattenedFrom).toBeNull();
  });

  it("persists the flattened state, so a reload does not bring the bands back", async () => {
    const first = await loadStore("/acme/projects/p1/issues");
    first.setGroupBy("module");
    first.flattenGrouping("module");

    expect((await loadStore("/acme/projects/p1/issues")).groupBy).toBe("none");
  });
});
