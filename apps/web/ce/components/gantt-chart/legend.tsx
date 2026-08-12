/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The legend. Mandatory whenever the chart is showing two or more series —
 * without it the colour is a puzzle rather than an encoding, and there is
 * nowhere on a bar to write "this teal one is Ruby".
 *
 * It carries two kinds of row and keeps them apart with a rule, because they
 * answer different questions:
 *
 *   series   which value of the colour-by dimension this bar has
 *   marks    what the chart draws on TOP of a bar regardless of its series —
 *            done, critical, milestone, the baseline ghost
 *
 * The folded entry ("Other (7)") names its members in a tooltip. A legend that
 * says "Other" and stops has hidden seven people from the person reading it.
 */
import type { FC } from "react";
import { CANCELLED_OUTLINE_WIDTH, completedFill, type TColorScale, type TSeries } from "./palette";

export type TLegendMark = {
  key: string;
  label: string;
  /** How to draw the swatch. `hollow` is a bar with its fill taken away and a
   *  line through it — what a cancelled item is drawn as. */
  kind: "hatch" | "hollow" | "line" | "dashed" | "diamond" | "ring";
  color: string;
  title?: string;
};

type Props = {
  scale: TColorScale | null;
  /** What the colour means, e.g. "Assignee". Named so the legend does not have
   *  to be read as a guess. */
  dimensionLabel?: string;
  marks?: TLegendMark[];
  className?: string;
};

const Swatch: FC<{ series: TSeries }> = ({ series }) => (
  <span
    aria-hidden
    className="inline-block size-3 flex-shrink-0 rounded-sm"
    style={{ backgroundColor: series.color, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }}
  />
);

const MarkSwatch: FC<{ mark: TLegendMark }> = ({ mark }) => {
  if (mark.kind === "hatch")
    return (
      <span
        aria-hidden
        className="inline-block h-3 w-4 flex-shrink-0 rounded-sm"
        style={{ backgroundImage: completedFill(mark.color), boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }}
      />
    );
  // Drawn the way the bar is: nothing inside it, its colour around it, struck.
  // The rule is a child rather than a `text-decoration`, because the swatch has
  // no text — and it is inset by a pixel so it reads as a strike over the bar
  // rather than as a second border.
  if (mark.kind === "hollow")
    return (
      <span
        aria-hidden
        className="relative inline-block h-3 w-4 flex-shrink-0 rounded-sm"
        style={{ border: `${CANCELLED_OUTLINE_WIDTH}px solid ${mark.color}` }}
      >
        <span
          className="absolute top-1/2 left-px h-px w-[calc(100%-2px)] -translate-y-1/2"
          style={{ backgroundColor: mark.color }}
        />
      </span>
    );
  if (mark.kind === "diamond")
    return (
      <span
        aria-hidden
        className="inline-block size-3 flex-shrink-0 rotate-45 rounded-[1px]"
        style={{ backgroundColor: mark.color }}
      />
    );
  if (mark.kind === "ring")
    return (
      <span
        aria-hidden
        className="inline-block size-3 flex-shrink-0 rounded-sm"
        style={{ boxShadow: `inset 0 0 0 1.5px ${mark.color}` }}
      />
    );
  return (
    <span
      aria-hidden
      className="inline-block h-0 w-4 flex-shrink-0"
      style={{
        borderTop: `2px ${mark.kind === "dashed" ? "dashed" : "solid"} ${mark.color}`,
      }}
    />
  );
};

export const GanttLegend: FC<Props> = ({ scale, dimensionLabel, marks = [], className }) => {
  const series = scale?.entries ?? [];
  // One series is not an encoding — the chart is one colour and the title says
  // what it is. Marks alone are still worth a legend, so this is not an early
  // return on `series.length < 2` for the whole component.
  const showSeries = series.length >= 2;
  if (!showSeries && marks.length === 0) return null;

  return (
    <div
      className={
        className ??
        "flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle px-4 py-1.5 text-11 text-secondary"
      }
    >
      {showSeries && dimensionLabel && (
        <span className="font-medium tracking-wide text-tertiary uppercase">{dimensionLabel}</span>
      )}
      {showSeries &&
        series.map((entry) => (
          <span
            key={entry.key || "__unset__"}
            className="flex items-center gap-1.5"
            // The fold names its members rather than hiding them, and every row
            // says how many bars it covers — which is often the answer the
            // reader wanted from the colour in the first place.
            title={
              entry.folded
                ? `${entry.count} item${entry.count === 1 ? "" : "s"} across: ${entry.folded.join(", ")}`
                : `${entry.count} item${entry.count === 1 ? "" : "s"}`
            }
          >
            <Swatch series={entry} />
            <span className={entry.unset ? "italic" : undefined}>{entry.label}</span>
          </span>
        ))}
      {showSeries && marks.length > 0 && <span aria-hidden className="h-3 w-px bg-layer-2" />}
      {marks.map((mark) => (
        <span key={mark.key} className="flex items-center gap-1.5" title={mark.title}>
          <MarkSwatch mark={mark} />
          {mark.label}
        </span>
      ))}
    </div>
  );
};
