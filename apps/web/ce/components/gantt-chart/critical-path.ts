/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * How the critical path is DRAWN. The computation lives on the server and is
 * fetched by `use-project-slack`; everything about turning that answer into a
 * picture is here, so it can be tested without a chart.
 *
 * ---------------------------------------------------------------------------
 * Why a mode and not another mark
 * ---------------------------------------------------------------------------
 *
 * The complaint is "je vois toujours pas le critical path affiché" while the
 * banner it quotes is working and the ring is already on the bars. Both are
 * true, and they explain each other: on the project the reader tried, **20 of
 * about 40 items are on the chain**. A mark that lands on half the rows is not a
 * highlight — there is no ground left for the figure to sit against. Making the
 * ring louder makes that worse, not better.
 *
 * So the chain is not given a fifth visual language. `palette.ts` already
 * carries the count: colour-by, two hatches, a tick, a ✕, a milestone diamond, a
 * progress fill, a baseline ghost, an overdue ring. Adding a fifth is how a board
 * becomes undecodable.
 *
 * Instead the chart gets a **second state**, entered from the banner:
 *
 *   at rest     exactly what it draws today — a thin ring on the chain, the
 *               banner sentence, one legend entry. "There is a chain, here it
 *               is."
 *
 *   focused     off-chain work is VEILED, on-chain work keeps full strength,
 *               the links between two on-chain items go loud and every other
 *               link goes quiet, and the float tails on the veiled bars keep
 *               their labels. Nothing new is drawn: what changes is what is
 *               allowed to be loud. That is a de-emphasis, not a language.
 *
 * The veil is the only thing here that is new, and it is deliberately a *surface*
 * wash rather than an opacity change on the bar: `fill-surface-1` follows the
 * theme, so the bar recedes toward the page in both, where a global opacity would
 * make a light bar pale and a dark bar muddy.
 *
 * ---------------------------------------------------------------------------
 * The red, and why it cannot be the only channel
 * ---------------------------------------------------------------------------
 *
 * `dc2626` (light) and `ef4444` (dark) both sit inside their theme's OKLCH
 * lightness band and clear 3:1 against their surface — white and the navy
 * `--neutral-100` `#0c151f` — which is what the validator is for.
 *
 * What the validator ALSO says is the reason for `CRITICAL_CASING_WIDTH`:
 *
 *   worst pair #6da122 ↔ #dc2626  ΔE 5.8 (deutan)
 *   worst pair #d8488c ↔ #dc2626  ΔE 12.3 (normal vision)
 *
 * — i.e. the critical red is NOT separable from two of the six series steps the
 * bars themselves are painted in. A red ring drawn tight against a red or a pink
 * bar is not a ring, it is a slightly thicker bar. So the ring is drawn over a
 * surface-coloured casing, which puts a hard edge of page colour between the bar
 * and the ring whatever the bar's series happens to be. Shape carries it; colour
 * confirms it. The banner names the chain in words and the legend has an entry,
 * so nothing here is colour alone.
 */

/** The chain's colour, per theme. See the note above for the validator run. */
export const CRITICAL_LIGHT = "#dc2626";
export const CRITICAL_DARK = "#ef4444";

export const criticalColor = (dark: boolean): string => (dark ? CRITICAL_DARK : CRITICAL_LIGHT);

/** How far outside the bar the ring sits, and how thick the ring and its casing
 *  are. The casing is wider than the ring so a hairline of page colour survives
 *  on both sides of it. */
export const CRITICAL_RING_OFFSET = 2.5;
export const CRITICAL_RING_WIDTH = 1.75;
export const CRITICAL_CASING_WIDTH = 3.5;

/**
 * How much of the page shows through a veiled bar.
 *
 * 0.62 so the bar's own label is still readable — a veiled row keeps its place in
 * the plan, it is being de-emphasised rather than hidden. It is also why the veil
 * is confined to the chart pane: the sidebar names every row at full contrast
 * whatever the chart is doing, so no row's identity ever depends on a washed
 * label. That, plus the mode being opt-in and one click to leave, is the relief
 * for deliberately lowering contrast on half the bars.
 */
export const VEIL_OPACITY = 0.62;

/**
 * What a row is drawn as.
 *
 *   `chain`  on the critical path
 *   `float`  has room to slip, and the chart is currently saying so
 *   `plain`  no opinion — the resting state for everything not on the chain
 */
export type TRowEmphasis = "chain" | "float" | "plain";

export const rowEmphasis = (isCritical: boolean, focused: boolean): TRowEmphasis => {
  if (isCritical) return "chain";
  return focused ? "float" : "plain";
};

/**
 * What a dependency link is drawn as.
 *
 * Three inputs, in priority order, because they answer different questions and
 * the reader can only be asked one at a time:
 *
 *   1. the pointer  — "what does THIS wait on" beats everything while it is
 *                     being asked, focused or not.
 *   2. the mode     — while the chain is focused, a link between two on-chain
 *                     items is the subject and everything else is context.
 *   3. at rest      — the resting weights, unchanged.
 *
 * Returned as a name rather than numbers so the caller owns the pixels and this
 * owns the decision — which is the half a test can pin.
 */
export type TLinkEmphasis = "loud" | "resting" | "quiet";

export const linkEmphasis = (input: {
  /** Either end is the block under the pointer. */
  related: boolean;
  /** Something is under the pointer, anywhere. */
  pointing: boolean;
  /** Both ends are on the critical path. */
  onChain: boolean;
  /** The chain is being focused. */
  focused: boolean;
}): TLinkEmphasis => {
  if (input.related) return "loud";
  if (input.pointing) return "quiet";
  if (input.focused) return input.onChain ? "loud" : "quiet";
  return "resting";
};

/**
 * The chain's span, for the banner.
 *
 * "20 work items with no room to slip" names a quantity and leaves the reader
 * with nothing to do about it. The date the chain ENDS is the thing that moves
 * when one of those twenty slips, and it is the sentence a project lead is
 * actually holding: *this* is the date at risk.
 *
 * Dates in, dates out — ISO `YYYY-MM-DD`, compared as strings, which is exactly
 * right for that format and avoids constructing a Date in a timezone this fork
 * has already been bitten by twice.
 */
export type TChainSpan = { start: string; end: string; dated: number } | null;

export const chainSpan = (
  ids: Iterable<string>,
  datesOf: (id: string) => { start_date?: string | null; target_date?: string | null } | undefined
): TChainSpan => {
  let start: string | null = null;
  let end: string | null = null;
  let dated = 0;
  for (const id of ids) {
    const item = datesOf(id);
    if (!item) continue;
    const from = item.start_date ?? item.target_date ?? null;
    const to = item.target_date ?? item.start_date ?? null;
    if (!from || !to) continue;
    dated += 1;
    if (!start || from < start) start = from;
    if (!end || to > end) end = to;
  }
  return start && end ? { start, end, dated } : null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An ISO `YYYY-MM-DD` as `18 Jul 2026`, WITHOUT constructing a Date.
 *
 * `new Date("2026-07-18")` is midnight UTC, so `toLocaleDateString` west of
 * Greenwich renders it as the 17th. This fork has already shipped that bug twice
 * — see the caller's-day work in `6448e35fd9` — and the CI now runs the web suite
 * under two non-UTC zones precisely so a regression of it fails. A date that is
 * already three integers does not need a timezone to be printed.
 */
export const formatChainDate = (iso: string): string => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!parts) return iso;
  const month = MONTHS[Number(parts[2]) - 1];
  if (!month) return iso;
  return `${Number(parts[3])} ${month} ${parts[1]}`;
};
