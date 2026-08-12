/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The colour scale for the chart, computed once and read by everything that
 * needs it: every bar, the legend, and the exporter.
 *
 * Once, and not per bar, because the scale is a fact about the WHOLE chart —
 * which values exist, how many rows each covers, which six get a hue and which
 * fold. A bar cannot work that out from itself, and the version that tried
 * (a hash of the assignee's uuid) is the reason this file exists.
 *
 * It is a context rather than a store because it is derived state with the
 * lifetime of a mounted chart. Two timelines can be on screen at once — the
 * portfolio's project rows and a peeked project's items — and they must not
 * share a scale computed from the other one's rows.
 */
import type { FC, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { observer } from "mobx-react";
import { buildColorScale, isDarkSurface, type TColorSample, type TColorScale } from "./palette";
import {
  colorSampleFor,
  dimensionOrder,
  GANTT_COLOR_OPTIONS,
  UNSET_LABEL,
  type TDimensionResolvers,
  type TGanttColorBy,
} from "./color-dimension";

export type TGanttColorContext = {
  scale: TColorScale;
  dimension: TGanttColorBy | string;
  /** What the legend calls the dimension, e.g. "Assignee". */
  dimensionLabel: string;
  /** Whether finished items are drawn distinctly. Read by the bars and by the
   *  legend, so the two can never disagree about whether the hatch is on. */
  showCompleted: boolean;
  dark: boolean;
  /**
   * The fill for one work item, or null to keep whatever the bar was already
   * painted. Published as a function rather than leaving each bar to call
   * `colorSampleFor` itself: the resolvers a sample needs are the chart's, not
   * the bar's, and a bar that had to fetch them would be re-deriving the scale's
   * own inputs one row at a time.
   */
  colorForIssue?: (issueId: string) => string | null;
  /** Which legend entry a work item reads under. The exporters carry it into the
   *  file so the drawn legend and the drawn bars cannot disagree. */
  seriesLabelForIssue?: (issueId: string) => string | undefined;
};

const GanttColorContext = createContext<TGanttColorContext | null>(null);

/** Null outside a provider, which is what every chart that has not opted in
 *  gets — those keep painting exactly what they painted before. */
export const useGanttColorScale = (): TGanttColorContext | null => useContext(GanttColorContext);

export const GanttColorScaleProvider: FC<{ value: TGanttColorContext | null; children: ReactNode }> = ({
  value,
  children,
}) => <GanttColorContext.Provider value={value}>{children}</GanttColorContext.Provider>;

export const labelForDimension = (dimension: TGanttColorBy): string =>
  GANTT_COLOR_OPTIONS.find((option) => option.value === dimension)?.label ?? dimension;

/**
 * Build the scale for a work-item timeline.
 *
 * `ids` must be the full set of rows the chart has loaded, not the visible
 * subset: a filter that changes which series are on screen must not repaint the
 * ones that survive.
 */
export const useIssueColorScale = (
  ids: string[],
  dimension: TGanttColorBy,
  getIssue: (id: string) => Parameters<typeof colorSampleFor>[1],
  resolvers: TDimensionResolvers,
  showCompleted: boolean
): TGanttColorContext => {
  const dark = isDarkSurface();
  // The whole scale is rebuilt when the row set or the dimension changes, which
  // is exactly when it can change. Rebuilding it per bar was the O(n^2) version
  // of this feature.
  const signature = `${dimension}|${dark}|${ids.length}|${ids.join(",")}`;
  const scale = useMemo(() => {
    const samples: TColorSample[] = ids.map((id) => colorSampleFor(dimension, getIssue(id), resolvers));
    return buildColorScale(samples, {
      dark,
      unsetLabel: UNSET_LABEL[dimension],
      order: dimensionOrder(dimension),
    });
    // getIssue and resolvers are store getters — stable for the life of the
    // chart, and re-running on their identity would rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return useMemo(
    () => ({
      scale,
      dimension,
      dimensionLabel: labelForDimension(dimension),
      showCompleted,
      dark,
      colorForIssue: (issueId: string) =>
        scale.seriesOf(colorSampleFor(dimension, getIssue(issueId), resolvers).key)?.color ?? null,
      seriesLabelForIssue: (issueId: string) =>
        scale.seriesOf(colorSampleFor(dimension, getIssue(issueId), resolvers).key)?.label,
    }),
    // getIssue and resolvers are store getters, stable for the life of the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scale, dimension, showCompleted, dark]
  );
};

/** The provider a chart mounts. Split from the hook so a caller that already has
 *  a scale (the portfolio builds its own from a different row shape) can share
 *  the same context. */
export const IssueColorScaleProvider = observer(function IssueColorScaleProvider(props: {
  ids: string[];
  dimension: TGanttColorBy;
  getIssue: (id: string) => Parameters<typeof colorSampleFor>[1];
  resolvers: TDimensionResolvers;
  showCompleted: boolean;
  children: ReactNode;
}) {
  const value = useIssueColorScale(props.ids, props.dimension, props.getIssue, props.resolvers, props.showCompleted);
  return <GanttColorScaleProvider value={value}>{props.children}</GanttColorScaleProvider>;
});
