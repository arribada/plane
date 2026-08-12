/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The shape of a dependency arrow, at the gaps where it used to draw badly.
 *
 * jsdom has no layout and no SVG renderer, so nothing here looks at a picture.
 * It walks the path data instead and asserts the things that make a picture
 * wrong: a segment that travels backwards, a corner bigger than the segment it
 * sits in, an arrowhead whose last segment is vertical, an arrow that never
 * reaches the bar it points at. Whether the result is *handsome* still needs a
 * browser; whether it is *correct* does not.
 */
import { describe, expect, it } from "vitest";
import { routeDependency, type TBarBox } from "./routing";

const ROW = 44; // BLOCK_HEIGHT

/** One row's bar. `row` is the row index; the arrow router only sees y. */
const bar = (left: number, width: number, row: number): TBarBox => ({
  left,
  right: left + width,
  y: row * ROW + ROW / 2,
});

type Point = { x: number; y: number };

/**
 * Walk the path into the points it visits. Arcs are treated as their chord,
 * which is all these assertions need — a quarter-circle corner never doubles
 * back, so the chord has the same sign of travel as the arc.
 */
const walk = (d: string): Point[] => {
  const tokens = d.trim().split(/\s+/);
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i];
    if (command === "M") {
      cursor = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
      points.push(cursor);
      i += 3;
    } else if (command === "H") {
      cursor = { x: Number(tokens[i + 1]), y: cursor.y };
      points.push(cursor);
      i += 2;
    } else if (command === "V") {
      cursor = { x: cursor.x, y: Number(tokens[i + 1]) };
      points.push(cursor);
      i += 2;
    } else if (command === "a") {
      // a rx ry rot large sweep dx dy  — relative
      cursor = { x: cursor.x + Number(tokens[i + 6]), y: cursor.y + Number(tokens[i + 7]) };
      points.push(cursor);
      i += 8;
    } else throw new Error(`unhandled path command ${command} in ${d}`);
  }
  return points;
};

/** Every horizontal move, signed. */
const horizontals = (points: Point[]): number[] => {
  const moves: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (dx !== 0) moves.push(dx);
  }
  return moves;
};

const lastSegmentIsHorizontal = (points: Point[]): boolean => {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  return !!before && before.y === end.y && before.x !== end.x;
};

describe("finish-to-start, successor after predecessor", () => {
  // 20px to the day is roughly the default "Days" column. The reported bug is
  // that J+1 and J+2 drew badly while J+3 drew well, so all three are pinned.
  const DAY = 20;
  const predecessor = bar(100, 80, 0); // ends at x=180

  it.each([
    ["J+3 — the gap that already looked right", 3],
    ["J+2", 2],
    ["J+1", 1],
  ])("%s never travels backwards", (_name, days) => {
    const successor = bar(180 + days * DAY, 60, 1);
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.route).toBe("direct");
    // THE regression. Every horizontal on a forward arrow must travel forward:
    // the old router emitted `H x2 - 12` at a one-day gap, which pointed back
    // the way it had come and drew a Z in the seam.
    for (const dx of horizontals(walk(arrow.d))) expect(dx).toBeGreaterThan(0);
  });

  it.each([1, 2, 3])("J+%i arrives on a horizontal, so the arrowhead points at the bar", (days) => {
    const successor = bar(180 + days * DAY, 60, 1);
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(lastSegmentIsHorizontal(walk(arrow.d))).toBe(true);
    expect(arrow.dir).toBe(1);
  });

  it.each([1, 2, 3])("J+%i stops within the head's reach of the successor's start", (days) => {
    const successor = bar(180 + days * DAY, 60, 1);
    const arrow = routeDependency(predecessor, successor, ROW);
    // Short of the bar, never inside it, and never further back than one head.
    expect(arrow.endX).toBeLessThanOrEqual(successor.left);
    expect(successor.left - arrow.endX).toBeLessThanOrEqual(6);
    expect(arrow.endY).toBe(successor.y);
  });

  it("crosses exactly one vertical, whatever the gap", () => {
    for (const days of [0, 1, 2, 3, 8, 40]) {
      const successor = bar(180 + days * DAY, 60, 1);
      const points = walk(routeDependency(predecessor, successor, ROW).d);
      const verticals = points.filter((p, i) => i > 0 && p.y !== points[i - 1].y).length;
      // Corners are arcs, so a single drop reads as three y-moves: into the
      // corner, down the run, out of the corner. Two drops would be a wrap.
      expect(verticals).toBeLessThanOrEqual(3);
    }
  });

  it("keeps every corner inside the segment it turns in", () => {
    // A radius larger than the run it sits in is how the old router produced a
    // backwards `H` before the corner. Proven by the monotonicity above, but
    // pinned directly at the tightest gap the direct route ever takes.
    const successor = bar(180, 60, 1); // gap 0
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.d).not.toMatch(/a \d/); // no arcs at all — squared off
  });
});

describe("zero gap — finishes J, starts J", () => {
  const predecessor = bar(100, 80, 0);
  const successor = bar(180, 60, 1); // starts exactly where the predecessor ends

  it("drops straight through the seam rather than stepping around it", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.route).toBe("direct");
    const points = walk(arrow.d);
    // One drop, and it happens within a few px of the seam.
    const drop = points.find((p, i) => i > 0 && p.y !== points[i - 1].y);
    expect(drop).toBeDefined();
    expect(Math.abs(drop!.x - 180)).toBeLessThanOrEqual(6);
  });

  it("still ends on a horizontal", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(lastSegmentIsHorizontal(walk(arrow.d))).toBe(true);
  });

  it("does not cross itself", () => {
    const points = walk(routeDependency(predecessor, successor, ROW).d);
    const moves = horizontals(points);
    // At a zero gap the vertical is pulled a hair back into the predecessor so
    // the head has something to point along; what must not happen is a move
    // forward followed by a move back, which is a crossing.
    const forward = moves.filter((m) => m > 0).length;
    const backward = moves.filter((m) => m < 0).length;
    expect(Math.min(forward, backward)).toBe(0);
  });
});

describe("overlap — the successor starts before the predecessor ends", () => {
  const predecessor = bar(100, 120, 0); // 100..220
  const successor = bar(160, 90, 1); //   160..250, starts 60px early

  it("wraps through the band between the rows", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.route).toBe("wrap");
    const points = walk(arrow.d);
    // Two drops: source row -> lane, lane -> target row.
    const lane = points.map((p) => p.y).filter((y, i, all) => i > 0 && y !== all[i - 1]);
    expect(lane.some((y) => y > predecessor.y && y < successor.y)).toBe(true);
  });

  it("leaves forwards, runs back, and comes in forwards", () => {
    const moves = horizontals(walk(routeDependency(predecessor, successor, ROW).d));
    expect(moves[0]).toBeGreaterThan(0);
    expect(moves.some((m) => m < 0)).toBe(true);
    expect(moves[moves.length - 1]).toBeGreaterThan(0);
  });

  it("arrives at the successor's start, not past it", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.endX).toBe(successor.left);
    expect(arrow.endY).toBe(successor.y);
    expect(lastSegmentIsHorizontal(walk(arrow.d))).toBe(true);
  });

  it("still wraps when the successor starts one pixel early", () => {
    // The boundary between the two routes. One pixel either side must not
    // produce a shape that crosses itself.
    const almost = bar(219, 90, 1);
    const arrow = routeDependency(predecessor, almost, ROW);
    expect(arrow.route).toBe("wrap");
    expect(lastSegmentIsHorizontal(walk(arrow.d))).toBe(true);
  });
});

describe("the successor sits entirely to the left", () => {
  const predecessor = bar(400, 80, 0);
  const successor = bar(100, 60, 1); // ends at 160, well left of 400

  it("mirrors instead of travelling back past both bars", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.mirrored).toBe(true);
    expect(arrow.dir).toBe(-1);
    for (const dx of horizontals(walk(arrow.d))) expect(dx).toBeLessThan(0);
  });

  it("arrives at the successor's END, which is the edge facing the predecessor", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.endX).toBeGreaterThanOrEqual(successor.right);
    expect(arrow.endX - successor.right).toBeLessThanOrEqual(6);
  });
});

describe("upwards, and other directions", () => {
  it("routes to a row above exactly as it routes to one below", () => {
    const down = routeDependency(bar(100, 60, 0), bar(200, 60, 3), ROW);
    const up = routeDependency(bar(100, 60, 3), bar(200, 60, 0), ROW);
    expect(up.route).toBe(down.route);
    expect(horizontals(walk(up.d)).every((dx) => dx > 0)).toBe(true);
    expect(lastSegmentIsHorizontal(walk(up.d))).toBe(true);
  });

  it("draws a plain line between two bars on the same row", () => {
    const arrow = routeDependency(bar(100, 60, 2), bar(220, 60, 2), ROW);
    expect(arrow.route).toBe("flat");
    expect(walk(arrow.d)).toHaveLength(2);
  });

  it("emits only finite numbers, at every gap from -60 to +200", () => {
    // A NaN in path data makes the whole path disappear silently, which is the
    // failure mode nobody notices until a screenshot is already in a report.
    for (let offset = -60; offset <= 200; offset += 1) {
      const arrow = routeDependency(bar(100, 80, 0), bar(180 + offset, 60, 1), ROW);
      expect(arrow.d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
