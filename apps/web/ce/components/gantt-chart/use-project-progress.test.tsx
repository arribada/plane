/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The progress fill the export reads is the one the bars are drawing.
 *
 * `useProjectProgress` is a per-bar hook over a per-project cache. The picture
 * export runs in a click handler, where no hook can be called, and used to set
 * no progress at all — so a chart whose bars were part-shaded on screen exported
 * flat. `peekProjectProgress` reads the same cache entry synchronously; these
 * pin that it answers what the hook answers, and nothing before the fetch.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectProgress } = vi.hoisted(() => ({ getProjectProgress: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getProjectProgress = getProjectProgress;
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceSlug: "arribada", projectId: "p1" }),
}));

import { invalidateProjectProgress, peekProjectProgress, useProjectProgress } from "./use-project-progress";

beforeEach(() => {
  getProjectProgress.mockReset();
  // The cache is module scope; start each test from nothing.
  invalidateProjectProgress("arribada", "p1");
});

describe("peekProjectProgress", () => {
  it("is empty for a project nothing has asked about", () => {
    expect(peekProjectProgress("arribada", "never")).toEqual({});
    expect(peekProjectProgress(undefined, "p1")).toEqual({});
  });

  it("answers what the bars are drawing once the project has answered", async () => {
    getProjectProgress.mockResolvedValue([
      { issue_id: "i1", percent: 40 },
      { issue_id: "i2", percent: 100 },
    ]);
    const { result } = renderHook(() => useProjectProgress("i1"));
    expect(result.current).toBe(0);
    expect(peekProjectProgress("arribada", "p1")).toEqual({});

    await waitFor(() => expect(result.current).toBe(40));
    expect(peekProjectProgress("arribada", "p1")).toEqual({ i1: 40, i2: 100 });
  });

  it("forgets the answer when the project's progress is invalidated", async () => {
    getProjectProgress.mockResolvedValue([{ issue_id: "i1", percent: 40 }]);
    const { result } = renderHook(() => useProjectProgress("i1"));
    await waitFor(() => expect(result.current).toBe(40));

    invalidateProjectProgress("arribada", "p1");
    expect(peekProjectProgress("arribada", "p1")).toEqual({});
  });
});
