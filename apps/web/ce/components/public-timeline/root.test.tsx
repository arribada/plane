/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The page an external funder sees, and the one reader in the product who cannot
 * be told to check their login.
 *
 * Only a 410 mapped to "revoked" and everything else fell through to "Nothing
 * here — check the address, or ask whoever sent it for the link again." So a
 * 500, an nginx 502 or a phone losing signal told somebody holding a perfectly
 * valid link that it did not exist. They cannot check the address: it is
 * correct, and the instruction is unfollowable.
 *
 * The last three tests fail against pre-fix HEAD, which answers all of them with
 * "Nothing here".
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicTimelineRoot } from "./root";

const { getPublicTimeline } = vi.hoisted(() => ({ getPublicTimeline: vi.fn() }));

vi.mock("@/plane-web/services/arribada.service", () => ({
  ArribadaService: class {
    getPublicTimeline = getPublicTimeline;
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ anchor: "abc123" }) }));

const PAYLOAD = {
  project: { name: "Sea Turtle Tag GPS", start_date: "2026-01-01", target_date: "2026-06-30" },
  items: [
    {
      name: "Fit the saltwater switch",
      start_date: "2026-02-01",
      target_date: "2026-02-14",
      state_group: "started",
      milestone: null,
    },
  ],
};

/** The sentence that must only ever appear for a link that genuinely is not there. */
const CHECK_THE_ADDRESS = /Check the address/;

beforeEach(() => {
  getPublicTimeline.mockResolvedValue(PAYLOAD);
});

describe("PublicTimelineRoot", () => {
  it("draws the schedule when the anchor resolves", async () => {
    render(<PublicTimelineRoot />);
    expect(await screen.findByText("Sea Turtle Tag GPS")).toBeInTheDocument();
  });

  it("says a revoked link was turned off, so the reader knows to ask for a new one", async () => {
    getPublicTimeline.mockRejectedValue({ status: 410, offline: false });
    render(<PublicTimelineRoot />);
    expect(await screen.findByText(/turned off/)).toBeInTheDocument();
  });

  it("says an unknown anchor is not there, so the reader checks what they typed", async () => {
    getPublicTimeline.mockRejectedValue({ status: 404, offline: false });
    render(<PublicTimelineRoot />);
    expect(await screen.findByText(CHECK_THE_ADDRESS)).toBeInTheDocument();
  });

  it("does NOT tell a funder their valid link is wrong when our server broke", async () => {
    getPublicTimeline.mockRejectedValue({ status: 500, offline: false });
    render(<PublicTimelineRoot />);

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_THE_ADDRESS)).not.toBeInTheDocument();
  });

  it("does NOT tell them it is wrong when a proxy answered with an error page", async () => {
    // A 502 carries HTML, so there is no `.error` to read — the status is the
    // only thing that says this is our end.
    getPublicTimeline.mockRejectedValue({ status: 502, offline: false });
    render(<PublicTimelineRoot />);

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_THE_ADDRESS)).not.toBeInTheDocument();
  });

  it("does NOT tell them it is wrong when their own connection dropped", async () => {
    getPublicTimeline.mockRejectedValue({ offline: true, status: undefined });
    render(<PublicTimelineRoot />);

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_THE_ADDRESS)).not.toBeInTheDocument();
  });
});
