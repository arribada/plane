/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Geometry for the free-placement board.
 *
 * Kept out of the component so the arithmetic can be read — and corrected —
 * without reading the pointer handling around it.
 */

/**
 * A note narrower than this loses its editor toolbar to wrapping, and one
 * shorter loses the title line: at that point the pointer can still shrink it
 * but nothing left on screen is big enough to grab and grow it again.
 *
 * The floor is what makes a resize reversible, so it is applied on the way out
 * as well as on the way in — a row written by the REST API, which takes any
 * float it is given, still renders at a size a pointer can recover.
 */
export const STICKY_MIN_WIDTH = 180;
export const STICKY_MIN_HEIGHT = 120;

/** Matches the w-[290px] the sticky already uses in its drag preview and popover. */
export const STICKY_DEFAULT_WIDTH = 290;
export const STICKY_DEFAULT_HEIGHT = 220;

/** The masonry's per-item padding is 8px a side; matching it keeps the seed honest. */
export const STICKY_CANVAS_GAP = 16;

/** Breathing room under the lowest note so the board can always be scrolled past. */
export const STICKY_CANVAS_PADDING = 120;

export type TStickyBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Nothing may be placed off the top or left edge, and nothing may be shrunk
 * below the floor. There is deliberately no right-hand bound: the board scrolls
 * horizontally, and clamping to the viewport would shuffle everyone's notes
 * whenever they resized the window or opened the sidebar.
 */
export const clampStickyBox = (box: TStickyBox): TStickyBox => ({
  x: Math.max(0, box.x),
  y: Math.max(0, box.y),
  width: Math.max(STICKY_MIN_WIDTH, box.width),
  height: Math.max(STICKY_MIN_HEIGHT, box.height),
});

/**
 * Where notes that have never been placed go once the board is in free mode.
 *
 * They exist: a note created after the switch, and every note past the first
 * page that arrives from infinite scroll. Without a slot they would all stack
 * at the origin on top of each other. These positions are computed, not saved —
 * a note only earns stored coordinates once someone actually moves it — so the
 * board does not fill up with placements nobody chose.
 */
export const getFallbackBoxes = (
  unplacedIds: string[],
  placedBoxes: TStickyBox[],
  canvasWidth: number
): Map<string, TStickyBox> => {
  const boxes = new Map<string, TStickyBox>();
  if (unplacedIds.length === 0) return boxes;

  const lowestBottom = placedBoxes.reduce((lowest, box) => Math.max(lowest, box.y + box.height), 0);
  const startY = placedBoxes.length > 0 ? lowestBottom + STICKY_CANVAS_GAP : 0;
  const step = STICKY_DEFAULT_WIDTH + STICKY_CANVAS_GAP;
  // At least one per row, or a narrow window would divide by zero and place
  // every note in the same column forever.
  const perRow = Math.max(1, Math.floor(canvasWidth / step));

  unplacedIds.forEach((id, index) => {
    boxes.set(id, {
      x: (index % perRow) * step,
      y: startY + Math.floor(index / perRow) * (STICKY_DEFAULT_HEIGHT + STICKY_CANVAS_GAP),
      width: STICKY_DEFAULT_WIDTH,
      height: STICKY_DEFAULT_HEIGHT,
    });
  });

  return boxes;
};

/** How tall the scroll area must be to contain every note plus room to spare. */
export const getCanvasHeight = (boxes: TStickyBox[]): number =>
  boxes.reduce((tallest, box) => Math.max(tallest, box.y + box.height), 0) + STICKY_CANVAS_PADDING;
