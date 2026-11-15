/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A choice made on one work item must not be shown on the next.
 *
 * The select holds the kind just chosen as an override until the shared cache
 * catches up — and that override was never cleared: not on success, not when
 * `issueId` changed. The peek and the page sidebar reuse this one instance as
 * the reader moves from item to item, so "delivery" picked on A was drawn on B,
 * a different work item nobody had marked. Both tests fail against pre-fix HEAD.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueMilestoneField } from "./field";

type TKinds = Record<string, { kind: "gate" | "delivery" | "review"; label: string; customLabel: string }>;

const { cache, setProjectMilestone } = vi.hoisted(() => ({
  cache: { milestones: {} as TKinds, listeners: new Set<() => void>() },
  setProjectMilestone: vi.fn(),
}));

// The real hook re-renders its readers from the inside when the cache changes,
// and the component is an `observer` (memoised), so a `rerender` with the same
// props would never reach it. This stand-in subscribes the same way.
vi.mock("@/plane-web/components/gantt-chart/use-project-milestones", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useProjectMilestones: () => {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((n) => n + 1);
        cache.listeners.add(listener);
        return () => {
          cache.listeners.delete(listener);
        };
      }, []);
      return cache.milestones;
    },
    invalidateProjectMilestones: vi.fn(),
  };
});

/** The refetch landing: what the server now says, pushed to every reader. */
const cacheNowSays = (milestones: TKinds) => {
  cache.milestones = milestones;
  act(() => cache.listeners.forEach((listener) => listener()));
};
vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    setProjectMilestone = setProjectMilestone;
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: vi.fn() }));

const fieldFor = (issueId: string) => (
  <IssueMilestoneField workspaceSlug="arribada" projectId="gps" issueId={issueId} isEditable />
);

const kindSelect = () => screen.getByRole("combobox", { name: /Whether this work item is a milestone/ });

beforeEach(() => {
  setProjectMilestone.mockResolvedValue({});
  // B is a gate already; A is an ordinary work item.
  cache.milestones = { "issue-b": { kind: "gate", label: "CDR", customLabel: "" } };
});

describe("IssueMilestoneField", () => {
  it("shows the next work item its OWN stored kind, not the one just chosen on the previous", async () => {
    const user = userEvent.setup();
    const { rerender } = render(fieldFor("issue-a"));

    await user.selectOptions(kindSelect(), "delivery");
    await waitFor(() => expect(setProjectMilestone).toHaveBeenCalledWith("arribada", "gps", "issue-a", "delivery"));
    // The cache has not caught up yet, so A keeps showing what was chosen.
    expect(kindSelect()).toHaveValue("delivery");

    rerender(fieldFor("issue-b"));

    expect(kindSelect()).toHaveValue("gate");
  });

  it("lets go of the choice once the cache agrees, so a later change elsewhere shows through", async () => {
    const user = userEvent.setup();
    render(fieldFor("issue-a"));

    await user.selectOptions(kindSelect(), "delivery");
    await waitFor(() => expect(setProjectMilestone).toHaveBeenCalled());

    // The refetch lands: the cache now says what the select says.
    cacheNowSays({ ...cache.milestones, "issue-a": { kind: "delivery", label: "A", customLabel: "" } });
    expect(kindSelect()).toHaveValue("delivery");

    // Unmarked from the timeline. With the override still held this read "delivery".
    cacheNowSays({ "issue-b": cache.milestones["issue-b"] });
    expect(kindSelect()).toHaveValue("");
  });
});
