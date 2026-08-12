/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where a dependency arrow goes. Pure geometry, no React, no store — so the
 * shape at a one-day gap is something a test can assert rather than something
 * somebody has to squint at.
 *
 * ---------------------------------------------------------------------------
 * What was wrong
 * ---------------------------------------------------------------------------
 *
 * The old router had two branches and picked between them on `|x2 - x1| >= 24`.
 * At a day column of ~20px that threshold falls between a one-day gap and a
 * two-day gap, which is exactly the band that was reported as drawing badly —
 * and three days, which draws fine, is just the other side of it.
 *
 * Below the threshold it ran a "step around": out 12px, down half a row, then
 * **back** to `x2 - 12`, down, and in. With a one-day gap `x2 - 12` sits LEFT of
 * where the arrow had just got to, so the middle segment ran backwards by a
 * handful of pixels and the arrow drew a little Z in the seam between two bars.
 * At a zero gap it also crossed itself. Neither is a rendering artefact; both
 * are what that arithmetic asks for.
 *
 * Above the threshold the radius was a constant 6px while the segments it had to
 * fit inside were as short as 8px, so `H (midX - dir*R)` could emit a horizontal
 * that pointed the wrong way before the corner.
 *
 * ---------------------------------------------------------------------------
 * What it does now
 * ---------------------------------------------------------------------------
 *
 * One decision, made on the sign of the room available rather than on a pixel
 * threshold:
 *
 *   span >= 0  the successor starts at or after the predecessor ends, so there
 *              is a seam to drop through — ONE vertical, placed near the target,
 *              with the corner radius shrunk to whatever actually fits. At a
 *              zero gap that degenerates, correctly, to a straight vertical line
 *              in the seam.
 *
 *   span <  0  the successor starts BEFORE the predecessor ends. There is no
 *              seam. The arrow leaves the predecessor, drops into the empty band
 *              between the two rows, runs back, and comes into the successor's
 *              start from the left — the shape every gantt tool draws for an
 *              overlap, and the shape the old code drew for cases that did not
 *              need it while not drawing it here at all.
 *
 * Every route ends with a horizontal run into the target. That is not cosmetic:
 * the arrowhead is an SVG marker with `orient="auto"`, so it points along the
 * last segment. End on the vertical and the head points at the floor.
 */

/** The straight run out of the predecessor and into the successor on a wrap. */
const STUB = 10;
/** Preferred distance from the target at which the vertical drops. */
const DROP_BEFORE = 20;
/** Shortest horizontal allowed at either end. Below this the arrowhead has
 *  nothing to take its bearing from. */
const MIN_RUN = 5;
/** Corner radius, before it is shrunk to fit. */
const RADIUS = 6;
/** How far the stroke stops short of the target edge, so the marker's tip lands
 *  on the edge rather than inside the bar. Never taken past the source. */
const HEAD_INSET = 6;

export type TBarBox = {
  left: number;
  right: number;
  /** Vertical centre of the row this bar is on. */
  y: number;
};

export type TArrowRoute = "direct" | "wrap" | "flat";

export type TArrow = {
  /** The SVG path data. */
  d: string;
  route: TArrowRoute;
  /** Where the stroke ends — the arrowhead's tip. */
  endX: number;
  endY: number;
  /** +1 when the arrow arrives travelling rightwards, -1 leftwards. */
  dir: 1 | -1;
  /** True when the pair is drawn mirrored because the successor sits entirely
   *  to the LEFT of the predecessor (a plan that has been re-dated, not an
   *  overlap). */
  mirrored: boolean;
};

/** Sweep flag for a quarter turn from a horizontal heading into a vertical one. */
const cornerHV = (hx: number, vy: number): 0 | 1 => (hx * vy > 0 ? 1 : 0);
/** …and from a vertical heading into a horizontal one. */
const cornerVH = (hx: number, vy: number): 0 | 1 => (hx * vy > 0 ? 0 : 1);

const round = (value: number): string => (Math.round(value * 10) / 10).toString();

/**
 * Finish-to-start arrow from `from` to `to`.
 *
 * `rowHeight` is only used by the wrap route, which needs somewhere empty to run
 * back through; half a row below the source is the band between two rows.
 */
export const routeDependency = (from: TBarBox, to: TBarBox, rowHeight: number): TArrow => {
  // Mirrored only when the successor sits ENTIRELY left of the predecessor.
  // Bars that merely overlap still read finish-to-start, which is what they are.
  const mirrored = to.right < from.left;
  const dir: 1 | -1 = mirrored ? -1 : 1;
  const x1 = mirrored ? from.left : from.right;
  const edge = mirrored ? to.right : to.left;
  const y1 = from.y;
  const y2 = to.y;
  const dy = y2 - y1;
  const down = dy >= 0 ? 1 : -1;

  // Edge-to-edge room, measured along the direction of travel.
  const span = dir * (edge - x1);

  // Same row: nothing to turn, and a corner here would be a kink over the bars.
  if (dy === 0) {
    const stop = edge - dir * Math.min(HEAD_INSET, Math.max(0, span));
    return { d: `M ${round(x1)} ${round(y1)} H ${round(stop)}`, route: "flat", endX: stop, endY: y1, dir, mirrored };
  }

  if (span >= 0) {
    // Never pull the stop back past the source: at a zero gap that would send
    // the arrow backwards to make room for its own head.
    const stop = edge - dir * Math.min(HEAD_INSET, span);
    const total = dir * (stop - x1); // >= 0

    // The vertical prefers to sit DROP_BEFORE from the target, but it always
    // leaves MIN_RUN of horizontal to arrive on. When there is not even that
    // much room the vertical is pulled a few pixels back INTO the predecessor —
    // which is invisible at this size, and is the difference between a correctly
    // pointed arrowhead and one aimed at the floor.
    const tail = total - MIN_RUN >= MIN_RUN ? Math.min(DROP_BEFORE, total - MIN_RUN) : MIN_RUN;
    const midX = stop - dir * tail;
    const lead = total - tail; // may be slightly negative; see above

    const startX = lead > 0 ? x1 : midX;
    const r = Math.min(RADIUS, Math.max(0, lead), tail, Math.abs(dy) / 2);

    const parts = [`M ${round(startX)} ${round(y1)}`];
    if (r >= 1) {
      parts.push(
        `H ${round(midX - dir * r)}`,
        `a ${r} ${r} 0 0 ${cornerHV(dir, down)} ${round(dir * r)} ${round(down * r)}`,
        `V ${round(y2 - down * r)}`,
        `a ${r} ${r} 0 0 ${cornerVH(dir, down)} ${round(dir * r)} ${round(down * r)}`,
        `H ${round(stop)}`
      );
    } else {
      // No room for corners — square them. This is the zero-gap picture: a
      // straight drop through the seam, then a short run into the successor.
      parts.push(`H ${round(midX)}`, `V ${round(y2)}`, `H ${round(stop)}`);
    }
    return { d: parts.join(" "), route: "direct", endX: stop, endY: y2, dir, mirrored };
  }

  // ── overlap: the successor starts before the predecessor ends ──────────────
  // No inset here. The wrap arrives along a full STUB of horizontal, so the
  // marker has all the bearing it needs and the tip belongs on the bar's edge.
  const stop = edge;
  const outX = x1 + dir * STUB;
  const inX = stop - dir * STUB;
  const laneY = y1 + down * (rowHeight / 2);
  const back = Math.abs(inX - outX); // >= 2 * STUB, because span < 0
  const r = Math.min(RADIUS, STUB, back / 2, Math.abs(laneY - y1), Math.abs(y2 - laneY));

  if (r < 1) {
    return {
      d: `M ${round(x1)} ${round(y1)} H ${round(outX)} V ${round(laneY)} H ${round(inX)} V ${round(y2)} H ${round(stop)}`,
      route: "wrap",
      endX: stop,
      endY: y2,
      dir,
      mirrored,
    };
  }

  // Out, down into the lane, back, down again, in. The middle run travels
  // against `dir`, so its corners take the opposite horizontal heading.
  const d = [
    `M ${round(x1)} ${round(y1)}`,
    `H ${round(outX - dir * r)}`,
    `a ${r} ${r} 0 0 ${cornerHV(dir, down)} ${round(dir * r)} ${round(down * r)}`,
    `V ${round(laneY - down * r)}`,
    `a ${r} ${r} 0 0 ${cornerVH(-dir, down)} ${round(-dir * r)} ${round(down * r)}`,
    `H ${round(inX + dir * r)}`,
    `a ${r} ${r} 0 0 ${cornerHV(-dir, down)} ${round(-dir * r)} ${round(down * r)}`,
    `V ${round(y2 - down * r)}`,
    `a ${r} ${r} 0 0 ${cornerVH(dir, down)} ${round(dir * r)} ${round(down * r)}`,
    `H ${round(stop)}`,
  ].join(" ");
  return { d, route: "wrap", endX: stop, endY: y2, dir, mirrored };
};

/**
 * The hierarchy bracket: a parent bar's start to a child bar's start. Not a
 * temporal dependency, so it is deliberately a different shape — a left-hand
 * rail rather than an arrow.
 */
export const routeParentBracket = (x1: number, y1: number, x2: number, y2: number): string => {
  const rail = Math.max(4, Math.min(x1, x2) - 10);
  return `M ${round(x1)} ${round(y1)} H ${round(rail)} V ${round(y2)} H ${round(x2)}`;
};
