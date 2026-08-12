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
 * Two rounds of this, and what was still wrong after the first
 * ---------------------------------------------------------------------------
 *
 * ROUND ONE replaced a pixel threshold (`|x2 - x1| >= 24`) with a branch on the
 * sign of the room available. That did remove the little Z the old router drew
 * in the seam, and it is live. It did not fix the picture the report is about,
 * because it treated "there is a seam" and "the seam is big enough to draw in"
 * as the same question. They are not:
 *
 *   gap 0px   `M 175 22 H 175 V 66 H 180`
 *
 * — the vertical is pulled 5px back INSIDE the predecessor, so the stroke runs
 * down over the bar it came from; the corner is square because no radius fits;
 * and the 5px run into the successor is shorter than the arrowhead, so the head
 * covers all of it. What is left on screen is a hard red L with a stub over the
 * predecessor's tail.
 *
 * Measured against the deployed commit, at a 20px day column: a ZERO gap draws
 * the stroke inside the predecessor, and a ONE-day gap leaves the bar with no
 * horizontal at all (`H` to where it already is, then straight into a corner) and
 * arrives on 4px of line — half an arrowhead. Two days and wider were already
 * fine, which is why "J+3 looks right" was in the first report. Overlaps drew a
 * band route with 4px ends, for the same reason: the corner was being paid for
 * out of the straight run's budget.
 *
 * ROUND TWO — this file — decides on whether the two ENDS fit, and makes the two
 * routes meet:
 *
 *   `outX` = LEAD past the predecessor's end. The first turn may not happen
 *            before it, so the arrow always leaves the bar along a horizontal.
 *   `inX`  = ARRIVE before the successor's start. The last turn may not happen
 *            after it, so the arrow always arrives along one, and the head —
 *            which is an SVG marker with `orient="auto"` — has a bearing.
 *
 *   inX at or past outX   the two ends fit in the seam: ONE vertical, placed as
 *                         close to the target as the room allows.
 *   inX behind outX       they do not: the arrow borrows the empty band between
 *                         the two rows — out, down into the band, back, down,
 *                         in. The shape every gantt tool draws when two bars are
 *                         too close to elbow between, and the shape this router
 *                         already drew for a true overlap while refusing to draw
 *                         it for the case that needed it most.
 *
 * The two are continuous. As the gap closes to LEAD + ARRIVE the single vertical
 * arrives at `outX === inX`; one pixel further the band route opens with a
 * back-run of one pixel. Nothing jumps, which is the property the pixel
 * threshold never had and the sign test only half had.
 *
 * Neither route is ever drawn over a bar: the band route's two verticals sit
 * PAST the predecessor's end and BEFORE the successor's start, and its back-run
 * is at the midpoint between the rows, where nothing is drawn.
 */

/**
 * Horizontal run out of the predecessor's end before anything may turn, and into
 * the successor's start after the last turn.
 *
 * These are the STRAIGHT runs and the corner radius is spent on top of them,
 * which is not a detail: budgeting the corner out of the same 8px meant a
 * six-pixel corner left two pixels of straight, and two pixels is less than the
 * arrowhead. The head then covered the whole of the last segment and took its
 * bearing off the curve — which is the same complaint as the original bug in a
 * different costume.
 *
 * 9px, against a 7px arrowhead, so a couple of pixels of line are visible behind
 * the head at every gap.
 */
const LEAD = 9;
const ARRIVE = 9;
/** Where the single vertical prefers to sit, measured back from the target. */
const DROP_BEFORE = 20;
/** Corner radius, before it is shrunk to whatever fits. */
const RADIUS = 6;

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
  /** Where the stroke ends — the arrowhead's tip, on the target bar's edge. */
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

/** `value`, held between `a` and `b` along the direction of travel. */
const clampAlong = (value: number, a: number, b: number, dir: 1 | -1): number => {
  const lo = dir > 0 ? a : b;
  const hi = dir > 0 ? b : a;
  return Math.max(lo, Math.min(hi, value));
};

/**
 * Finish-to-start arrow from `from` to `to`.
 *
 * `rowHeight` is only used by the band route, which needs somewhere empty to run
 * back through; half a row below the source is the gap between two rows, and the
 * bars are 18px inside a 44px row, so there are 13px of clear space either side
 * of it.
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

  // Same row: nothing to turn, and a corner here would be a kink over the bars.
  if (dy === 0) {
    return { d: `M ${round(x1)} ${round(y1)} H ${round(edge)}`, route: "flat", endX: edge, endY: y1, dir, mirrored };
  }

  // Edge-to-edge room along the direction of travel, and what the two straight
  // runs need out of it. A corner costs its radius on each side, so the radius is
  // whatever is left over after both runs have been paid — which makes it zero at
  // the boundary and RADIUS once there is comfortably room, with no step between.
  const span = dir * (edge - x1);
  const slack = span - LEAD - ARRIVE;

  if (slack >= 0) {
    const r = Math.min(RADIUS, slack / 2, Math.abs(dy) / 2);
    // One vertical. It prefers to sit DROP_BEFORE from the target — close enough
    // that the drop reads as belonging to the successor — but it may not eat into
    // either straight run, so on a tight gap it lands exactly between them.
    const outX = x1 + dir * (LEAD + r);
    const inX = edge - dir * (ARRIVE + r);
    const midX = clampAlong(edge - dir * DROP_BEFORE, outX, inX, dir);

    const parts = [`M ${round(x1)} ${round(y1)}`];
    if (r >= 1) {
      parts.push(
        `H ${round(midX - dir * r)}`,
        `a ${r} ${r} 0 0 ${cornerHV(dir, down)} ${round(dir * r)} ${round(down * r)}`,
        `V ${round(y2 - down * r)}`,
        `a ${r} ${r} 0 0 ${cornerVH(dir, down)} ${round(dir * r)} ${round(down * r)}`,
        `H ${round(edge)}`
      );
    } else {
      parts.push(`H ${round(midX)}`, `V ${round(y2)}`, `H ${round(edge)}`);
    }
    return { d: parts.join(" "), route: "direct", endX: edge, endY: y2, dir, mirrored };
  }

  // ── the ends do not fit in the seam: borrow the band between the rows ───────
  //
  // The back-run is `LEAD + ARRIVE - span` of straight, which is 0 at the
  // boundary and grows as the bars close and then overlap. That is why the two
  // routes meet rather than jump: at `slack === 0` this shape IS the shape above,
  // with a back-run of nothing.
  const laneY = y1 + down * (rowHeight / 2);
  const r = Math.min(RADIUS, Math.abs(laneY - y1), Math.abs(y2 - laneY));
  const outX = x1 + dir * (LEAD + r);
  const inX = edge - dir * (ARRIVE + r);

  if (r < 1) {
    // Only reachable on a chart whose rows are a handful of pixels tall — there
    // is no vertical room for a corner, so it is squared off. Kept as a floor
    // rather than an assumption about `rowHeight`.
    return {
      d: `M ${round(x1)} ${round(y1)} H ${round(outX)} V ${round(laneY)} H ${round(inX)} V ${round(y2)} H ${round(edge)}`,
      route: "wrap",
      endX: edge,
      endY: y2,
      dir,
      mirrored,
    };
  }

  // Out, down into the band, back, down again, in. The middle run travels
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
    `H ${round(edge)}`,
  ].join(" ");
  return { d, route: "wrap", endX: edge, endY: y2, dir, mirrored };
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
