/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio's colour scale, computed once for the whole board.
 *
 * Once, and not per bar, because which six values get a hue is a fact about the
 * WHOLE board — how many distinct sprints exist, which of them cover the most
 * rows, which fold. A bar cannot work that out from itself, and the version that
 * tried (a hash of the id) is the reason `palette.ts` exists.
 *
 * The domain is every item the board has LOADED, not the rows currently drawn.
 * Folding a project shut, or filtering to one priority, must not repaint the
 * bars that survive — colour follows the entity, never its rank in whatever
 * subset is on screen.
 */
import { useMemo } from "react";
import { useProjectState } from "@/hooks/store/use-project-state";
import {
  buildColorScale,
  isDarkSurface,
  unsetColor,
  type TColorSample,
  type TColorScale,
} from "@/plane-web/components/gantt-chart/palette";
import type { TGanttColorContext } from "@/plane-web/components/gantt-chart/color-scale";
import type { TPortfolioColorBy, TPortfolioItem } from "@/plane-web/types/arribada";
import {
  isSeriesDimension,
  PORTFOLIO_COLOR_OPTIONS,
  PORTFOLIO_PRIORITY_ORDER,
  PORTFOLIO_UNSET_LABEL,
  portfolioItemSample,
  type TPortfolioColorResolvers,
} from "./color";

export const portfolioDimensionLabel = (dimension: TPortfolioColorBy): string =>
  PORTFOLIO_COLOR_OPTIONS.find((option) => option.value === dimension)?.label ?? dimension;

/** What the board needs to expose for a scale to be built over it. A shape, not
 *  the store class, so a test can hand it two plain objects. */
export type TPortfolioColorSource = {
  /** Every work item the board has fetched, whatever is folded. */
  loadedItems: TPortfolioItem[];
  colorBy: TPortfolioColorBy;
};

export const buildPortfolioColorScale = (
  source: TPortfolioColorSource,
  resolvers: TPortfolioColorResolvers,
  dark: boolean
): TColorScale | null => {
  if (!isSeriesDimension(source.colorBy)) return null;
  const samples: TColorSample[] = source.loadedItems.map((item) =>
    portfolioItemSample(source.colorBy, item, resolvers)
  );
  return buildColorScale(samples, {
    dark,
    unsetLabel: PORTFOLIO_UNSET_LABEL[source.colorBy],
    // Frequency is the right order for people and sprints; it is the wrong order
    // for a severity.
    order: source.colorBy === "priority" ? PORTFOLIO_PRIORITY_ORDER : undefined,
  });
};

/**
 * The context the portfolio publishes to its bars and its legend.
 *
 * Deliberately the same `TGanttColorContext` the work-item timeline uses, so the
 * legend component and the exporters do not need to know which of the two boards
 * they were handed.
 */
export const usePortfolioColorScale = (
  loadedItems: TPortfolioItem[],
  colorBy: TPortfolioColorBy,
  showCompleted: boolean
): TGanttColorContext => {
  const { getStateById } = useProjectState();
  const dark = isDarkSurface();

  // The signature is what actually changes the answer: the dimension, the theme,
  // and the values present. Rebuilding on the array's identity would rebuild on
  // every render of every bar, which is the O(n²) version of this feature.
  const signature = useMemo(
    () =>
      `${colorBy}|${dark}|${loadedItems
        .map(
          (item) =>
            `${item.id}:${item.state_id ?? ""}:${item.priority}:${item.cycle?.id ?? ""}:${item.module?.id ?? ""}`
        )
        .join(",")}`,
    [colorBy, dark, loadedItems]
  );

  const scale = useMemo(
    () => buildPortfolioColorScale({ loadedItems, colorBy }, { getState: getStateById }, dark),
    // getStateById is a store getter — stable for the life of the board, and
    // re-running on its identity would rebuild the scale on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
  );

  return useMemo(
    () => ({
      // A null scale (colour by project) still publishes a context: the bars need
      // `showCompleted` whether or not there is a series encoding in force.
      scale: scale ?? { entries: [], colorOf: () => unsetColor(dark), seriesOf: () => undefined },
      dimension: colorBy,
      dimensionLabel: portfolioDimensionLabel(colorBy),
      showCompleted,
      dark,
    }),
    [scale, colorBy, showCompleted, dark]
  );
};
