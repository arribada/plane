/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The shape of a dependency arrow, at the gaps where it draws badly.
 *
 * ---------------------------------------------------------------------------
 * What these tests prove, and what they do not
 * ---------------------------------------------------------------------------
 *
 * jsdom has no layout and no SVG renderer, so nothing here looks at a picture.
 * The previous round of this file passed while the reported bug was still on
 * screen, which is the reason for this note: it asserted that no segment
 * travelled backwards and that the last one was horizontal, and BOTH were true
 * of `M 175 22 H 175 V 66 H 180` — a vertical drawn down through the middle of
 * the predecessor's tail with a 5px stub the arrowhead completely covered. The
 * assertions were right about what they said and said the wrong things.
 *
 * So this round asserts the things that were actually wrong in the screenshot:
 *
 *   - **no part of the stroke may be drawn inside either bar** (`insideAnyBar`).
 *     That is the defect. Everything else was cosmetics on top of it.
 *   - the run into the target is at least as long as the arrowhead, so the head
 *     is not the entire visible arrow.
 *   - the route does not JUMP as the gap closes — the two branches are sampled
 *     either side of their boundary and must agree to within a pixel. A pixel
 *     threshold and a sign test both failed this, differently.
 *   - all of the above swept over five day-widths, both directions, and every
 *     gap from a three-day overlap to five days apart.
 *
 * What still needs a real screen: whether the result is HANDSOME. Whether an
 * 8px jog between two touching bars reads as elegant or as a wiggle, whether the
 * red is too loud, whether two arrows landing on the same bar collide. None of
 * that is decidable here and none of it should be claimed from a green tick.
 */
import { describe, expect, it } from "vitest";
import { routeDependency, type TBarBox } from "./routing";

const ROW = 44; // BLOCK_HEIGHT
const BAR = 18; // the drawn height of a bar inside its row

/** One row's bar. `row` is the row index; the arrow router only sees y. */
const bar = (left: number, width: number, row: number): TBarBox => ({
  left,
  right: left + width,
  y: row * ROW + ROW / 2,
});

type Point = { x: number; y: number };

/**
 * Walk the path into the points it visits, arcs included.
 *
 * Arcs are sampled rather than chorded: a corner bulges toward the corner it is
 * rounding, and "is any of this inside the bar" is a question a chord can answer
 * wrongly by a pixel and a half.
 */
const walk = (d: string): Point[] => {
  const tokens = d.trim().split(/\s+/);
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let i = 0;
  const push = (x: number, y: number) => {
    cursor = { x, y };
    points.push(cursor);
  };
  while (i < tokens.length) {
    const command = tokens[i];
    if (command === "M") {
      push(Number(tokens[i + 1]), Number(tokens[i + 2]));
      i += 3;
    } else if (command === "H") {
      push(Number(tokens[i + 1]), cursor.y);
      i += 2;
    } else if (command === "V") {
      push(cursor.x, Number(tokens[i + 1]));
      i += 2;
    } else if (command === "a") {
      // a rx ry rot large sweep dx dy — relative, and always a quarter turn here.
      const r = Number(tokens[i + 1]);
      const sweep = Number(tokens[i + 5]);
      const end = { x: cursor.x + Number(tokens[i + 6]), y: cursor.y + Number(tokens[i + 7]) };
      // For a quarter turn the centre is one of the two box corners, and BOTH sit
      // at distance r from both endpoints — so a distance check alone picks the
      // wrong one half the time and sweeps 270° the long way round the circle,
      // which is how an arc that stays inside its corner samples as a bulge 4px
      // outside it. The sweep flag is what tells them apart: only one of the two
      // covers a quarter turn in the direction the flag names.
      const arc = [
        { x: cursor.x, y: end.y },
        { x: end.x, y: cursor.y },
      ]
        .map((centre) => {
          const a0 = Math.atan2(cursor.y - centre.y, cursor.x - centre.x);
          let a1 = Math.atan2(end.y - centre.y, end.x - centre.x);
          if (sweep === 1 && a1 < a0) a1 += 2 * Math.PI;
          if (sweep === 0 && a1 > a0) a1 -= 2 * Math.PI;
          return { centre, a0, a1 };
        })
        .find((candidate) => Math.abs(Math.abs(candidate.a1 - candidate.a0) - Math.PI / 2) < 0.01);
      if (!arc) throw new Error(`no quarter-turn centre for arc in ${d}`);
      for (let k = 1; k <= 8; k++) {
        const a = arc.a0 + ((arc.a1 - arc.a0) * k) / 8;
        push(arc.centre.x + r * Math.cos(a), arc.centre.y + r * Math.sin(a));
      }
      i += 8;
    } else throw new Error(`unhandled path command ${command} in ${d}`);
  }
  return points;
};

/** Every point the stroke passes through, straights sampled finely enough that a
 *  segment cannot slip through a bar between two samples. */
const trace = (d: string): Point[] => {
  const corners = walk(d);
  const out: Point[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let k = 1; k <= steps; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  return out;
};

/** Every horizontal move between corners, signed. */
const horizontals = (points: Point[]): number[] => {
  const moves: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (Math.abs(dx) > 0.001) moves.push(dx);
  }
  return moves;
};

const lastSegmentIsHorizontal = (points: Point[]): boolean => {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  return !!before && Math.abs(before.y - end.y) < 0.001 && Math.abs(before.x - end.x) > 0.001;
};

/**
 * THE assertion. No sampled point of the stroke may sit inside either bar's
 * rectangle. A tolerance of half a pixel, because the path legitimately STARTS
 * on the predecessor's edge and ENDS on the successor's.
 */
const insideAnyBar = (d: string, boxes: TBarBox[]): Point | null => {
  const eps = 0.5;
  for (const p of trace(d)) {
    for (const b of boxes) {
      if (p.x > b.left + eps && p.x < b.right - eps && p.y > b.y - BAR / 2 + eps && p.y < b.y + BAR / 2 - eps) return p;
    }
  }
  return null;
};

/** The horizontal extent a shape occupies, for the continuity comparison. */
const spread = (points: Point[]): { minX: number; maxX: number } => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
});

/** A route drawn as a series of straight runs, for the crossing test. */
const runs = (points: Point[]): { x0: number; x1: number; y: number }[] => {
  const out: { x0: number; x1: number; y: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].y - points[i - 1].y) > 0.001) continue;
    if (Math.abs(points[i].x - points[i - 1].x) < 0.001) continue;
    out.push({ x0: points[i - 1].x, x1: points[i].x, y: points[i].y });
  }
  return out;
};

/** Two horizontal runs at the same height going opposite ways and overlapping is
 *  a stroke drawn back over itself — the "stub that doubles back". */
const doublesBackOverItself = (d: string): boolean => {
  const all = runs(walk(d));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (Math.abs(all[i].y - all[j].y) > 0.001) continue;
      const forwardI = all[i].x1 > all[i].x0;
      const forwardJ = all[j].x1 > all[j].x0;
      if (forwardI === forwardJ) continue;
      const lo = Math.max(Math.min(all[i].x0, all[i].x1), Math.min(all[j].x0, all[j].x1));
      const hi = Math.min(Math.max(all[i].x0, all[i].x1), Math.max(all[j].x0, all[j].x1));
      if (hi - lo > 0.001) return true;
    }
  }
  return false;
};

describe("the stroke is never drawn over a bar", () => {
  // THE defect in the report: at a gap of about zero the vertical was pulled 5px
  // back INSIDE the predecessor, so the arrow ran down over the bar it came from
  // and the reader saw a hard L with a stub on it. The picture was correct
  // arithmetic — which is why the previous round's assertions all passed.
  it.each([
    ["a three-day overlap", -3],
    ["a one-day overlap", -1],
    ["touching", 0],
    ["one day", 1],
    ["two days", 2],
    ["three days", 3],
    ["five days", 5],
  ])("%s", (_name, days) => {
    for (const DAY of [5, 12, 20, 40, 60]) {
      const predecessor = bar(200, 4 * DAY, 0);
      const successor = bar(predecessor.right + days * DAY, 4 * DAY, 1);
      const arrow = routeDependency(predecessor, successor, ROW);
      const trespass = insideAnyBar(arrow.d, [predecessor, successor]);
      expect(trespass, `day=${DAY} gap=${days}d route=${arrow.route} d=${arrow.d}`).toBeNull();
    }
  });

  it("holds when the successor is on the row ABOVE", () => {
    for (const DAY of [5, 20, 60]) {
      for (const days of [-2, 0, 1, 2, 4]) {
        const predecessor = bar(200, 3 * DAY, 3);
        const successor = bar(predecessor.right + days * DAY, 3 * DAY, 0);
        const arrow = routeDependency(predecessor, successor, ROW);
        expect(insideAnyBar(arrow.d, [predecessor, successor]), `up day=${DAY} gap=${days}`).toBeNull();
      }
    }
  });
});

describe("every route, at every gap and zoom", () => {
  const cases: { day: number; days: number; down: boolean }[] = [];
  for (const day of [5, 12, 20, 40, 60])
    for (let days = -3; days <= 5; days += 0.5) for (const down of [true, false]) cases.push({ day, days, down });

  it("leaves the predecessor's end and arrives at the successor's start, on a horizontal", () => {
    for (const { day, days, down } of cases) {
      const predecessor = bar(200, 4 * day, down ? 0 : 2);
      const successor = bar(predecessor.right + days * day, 4 * day, down ? 1 : 0);
      const arrow = routeDependency(predecessor, successor, ROW);
      const points = walk(arrow.d);
      const label = `day=${day} gap=${days} down=${down}`;
      // Starts exactly on the predecessor's finish edge — never pulled back into
      // it to make room for something.
      expect(points[0].x, label).toBeCloseTo(predecessor.right, 5);
      expect(points[0].y, label).toBeCloseTo(predecessor.y, 5);
      // Ends exactly on the successor's start edge, which is where the arrowhead's
      // tip belongs now the marker is in user space.
      expect(arrow.endX, label).toBeCloseTo(successor.left, 5);
      expect(arrow.endY, label).toBeCloseTo(successor.y, 5);
      expect(lastSegmentIsHorizontal(points), label).toBe(true);
    }
  });

  it("gives the arrowhead a straight run at least as long as it is", () => {
    // The head is 7px in user space. A 5px final segment — which is what a zero
    // gap used to produce — is entirely covered by its own arrowhead, so what
    // reaches the screen is a vertical line ending in a triangle. A 2px one, which
    // is what budgeting the corner radius out of the same 8px produced, is worse:
    // the head then takes its bearing off a curve.
    for (const { day, days, down } of cases) {
      const predecessor = bar(200, 4 * day, down ? 0 : 2);
      const successor = bar(predecessor.right + days * day, 4 * day, down ? 1 : 0);
      const points = walk(routeDependency(predecessor, successor, ROW).d);
      const last = points[points.length - 1];
      const before = points[points.length - 2];
      expect(Math.abs(last.x - before.x), `day=${day} gap=${days} down=${down}`).toBeGreaterThanOrEqual(7);
    }
  });

  it("leaves the predecessor along a straight run of its own", () => {
    // Symmetrical, and for a related reason: an arrow that curls away the instant
    // it leaves the bar does not read as coming OUT of the bar's finish.
    for (const { day, days, down } of cases) {
      const predecessor = bar(200, 4 * day, down ? 0 : 2);
      const successor = bar(predecessor.right + days * day, 4 * day, down ? 1 : 0);
      const points = walk(routeDependency(predecessor, successor, ROW).d);
      expect(Math.abs(points[1].x - points[0].x), `day=${day} gap=${days} down=${down}`).toBeGreaterThanOrEqual(7);
      expect(points[1].y).toBeCloseTo(points[0].y, 5);
    }
  });

  it("never draws a run back over one it has already drawn", () => {
    for (const { day, days, down } of cases) {
      const predecessor = bar(200, 4 * day, down ? 0 : 2);
      const successor = bar(predecessor.right + days * day, 4 * day, down ? 1 : 0);
      const arrow = routeDependency(predecessor, successor, ROW);
      expect(doublesBackOverItself(arrow.d), `day=${day} gap=${days} d=${arrow.d}`).toBe(false);
    }
  });

  it("emits only finite numbers", () => {
    // A NaN in path data makes the whole path disappear silently, which is the
    // failure mode nobody notices until a screenshot is already in a report.
    for (const { day, days, down } of cases) {
      const predecessor = bar(200, 4 * day, down ? 0 : 2);
      const successor = bar(predecessor.right + days * day, 4 * day, down ? 1 : 0);
      expect(routeDependency(predecessor, successor, ROW).d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe("the two routes meet", () => {
  // The whole point of the rewrite. A pixel threshold put a discontinuity in the
  // middle of the one-to-two-day band; branching on the sign of the room moved it
  // to exactly zero, which is where bars touch and therefore where it was seen.
  // Deciding on whether the two ENDS fit means the branch is taken where the
  // shapes are already the same.
  const predecessor = bar(200, 80, 0);

  it("draws nearly the same picture a pixel either side of the boundary", () => {
    // Sweep for the crossing, so this cannot silently pass by testing two points
    // that are both on the same side of it.
    let boundary: number | null = null;
    let previous = routeDependency(predecessor, bar(predecessor.right - 40, 80, 1), ROW).route;
    for (let offset = -40; offset <= 80; offset += 1) {
      const route = routeDependency(predecessor, bar(predecessor.right + offset, 80, 1), ROW).route;
      if (route !== previous) boundary = offset;
      previous = route;
    }
    expect(boundary, "expected exactly one route change in the swept range").not.toBeNull();

    const before = walk(routeDependency(predecessor, bar(predecessor.right + boundary! - 1, 80, 1), ROW).d);
    const after = walk(routeDependency(predecessor, bar(predecessor.right + boundary! + 1, 80, 1), ROW).d);
    // Same start and same end within the two pixels the target actually moved.
    expect(Math.abs(before[0].x - after[0].x)).toBeLessThanOrEqual(0.01);
    // The furthest either shape strays from the other's bounding box.
    const a = spread(before);
    const b = spread(after);
    expect(Math.abs(a.minX - b.minX)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(a.maxX - b.maxX)).toBeLessThanOrEqual(2.5);
  });

  it("switches to the band route only when the two ends no longer fit in the seam", () => {
    // LEAD (9) + ARRIVE (9). Above it there is room for one vertical between the
    // two straight runs; below it there is not, and the band between the rows is
    // where the arrow goes instead.
    expect(routeDependency(predecessor, bar(predecessor.right + 19, 80, 1), ROW).route).toBe("direct");
    expect(routeDependency(predecessor, bar(predecessor.right + 17, 80, 1), ROW).route).toBe("wrap");
  });
});

describe("the band route", () => {
  const predecessor = bar(100, 120, 0); // 100..220
  const successor = bar(160, 90, 1); //   160..250, starts 60px early

  it("runs back through the empty band between the two rows", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.route).toBe("wrap");
    const ys = walk(arrow.d).map((p) => p.y);
    // Something is drawn strictly between the two rows' centres, which is where
    // neither bar is.
    expect(ys.some((y) => y > predecessor.y + BAR / 2 && y < successor.y - BAR / 2)).toBe(true);
  });

  it("leaves forwards, runs back, and comes in forwards", () => {
    const moves = horizontals(walk(routeDependency(predecessor, successor, ROW).d));
    expect(moves[0]).toBeGreaterThan(0);
    expect(moves.some((m) => m < 0)).toBe(true);
    expect(moves[moves.length - 1]).toBeGreaterThan(0);
  });

  it("is what a zero gap draws, because a zero gap has no seam to drop through", () => {
    const arrow = routeDependency(bar(100, 80, 0), bar(180, 60, 1), ROW);
    expect(arrow.route).toBe("wrap");
    expect(arrow.endX).toBe(180);
  });
});

describe("the successor sits entirely to the left", () => {
  const predecessor = bar(400, 80, 0);
  const successor = bar(100, 60, 1); // ends at 160, well left of 400

  it("mirrors instead of travelling back past both bars", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.mirrored).toBe(true);
    expect(arrow.dir).toBe(-1);
    expect(insideAnyBar(arrow.d, [predecessor, successor])).toBeNull();
  });

  it("arrives at the successor's END, which is the edge facing the predecessor", () => {
    const arrow = routeDependency(predecessor, successor, ROW);
    expect(arrow.endX).toBe(successor.right);
    expect(lastSegmentIsHorizontal(walk(arrow.d))).toBe(true);
  });
});

describe("same row", () => {
  it("draws a plain line between two bars on the same row", () => {
    const arrow = routeDependency(bar(100, 60, 2), bar(220, 60, 2), ROW);
    expect(arrow.route).toBe("flat");
    expect(walk(arrow.d)).toHaveLength(2);
    expect(arrow.endX).toBe(220);
  });
});
