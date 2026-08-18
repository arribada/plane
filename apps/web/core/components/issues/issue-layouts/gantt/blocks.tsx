/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Popover } from "@plane/propel/popover";
import { Tooltip } from "@plane/propel/tooltip";
import { ControlLink } from "@plane/ui";
import { findTotalDaysInRange, generateWorkItemLink } from "@plane/utils";
// components
import { GANTT_SIDEBAR_COLLAPSED_WIDTH } from "@/components/gantt-chart/constants";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// plane web imports
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
// local imports
import { useProjectMilestones } from "@/plane-web/components/gantt-chart/use-project-milestones";
import { barLook } from "@/plane-web/components/gantt-chart/bar-appearance";
import { useGanttColorScale } from "@/plane-web/components/gantt-chart/color-scale";
import { CANCELLED_GLYPH, cancelledFill, completedFill, DONE_GLYPH } from "@/plane-web/components/gantt-chart/palette";
import { useProjectProgress } from "@/plane-web/components/gantt-chart/use-project-progress";
import { WorkItemPreviewCard } from "../../preview-card";
import { getBlockViewDetails } from "../utils";
import type { GanttStoreType } from "./base-gantt-root";

type Props = {
  issueId: string;
  isEpic?: boolean;
};

export const IssueGanttBlock = observer(function IssueGanttBlock(props: Props) {
  const { issueId, isEpic } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const { getProjectStates } = useProjectState();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { sidebarWidth, isSidebarCollapsed } = useTimeLineChartStore();
  // The chart-wide colour scale. Null outside a provider, in which case the bar
  // keeps its state colour exactly as it always did.
  const colors = useGanttColorScale();
  // hooks
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const sidebarPaneWidth = isSidebarCollapsed ? GANTT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const issueDetails = getIssueById(issueId);
  const stateDetails =
    issueDetails && getProjectStates(issueDetails?.project_id)?.find((state) => state?.id == issueDetails?.state_id);

  const { blockStyle } = getBlockViewDetails(issueDetails, stateDetails?.color ?? "");
  /**
   * The user's "colour by" choice, resolved against the scale the whole chart
   * shares. It used to be decided here, per bar, by hashing the assignee's uuid
   * into an HSL hue — which cannot promise that two people differ, because one
   * bar cannot see the other. See the note at the top of `palette.ts`.
   *
   * Null when the chart mounted no provider, or when the dimension is `state` —
   * a state's colour is the team's own and is what every other screen paints it
   * with, so it is passed straight through rather than repainted here.
   */
  const colorOverride = colors?.colorForIssue?.(issueId) ?? null;
  const fill = colorOverride || stateDetails?.color || "#3b82f6";
  // undefined when this project has no marks at all, which is what makes barLook
  // fall back to the same-day guess rather than declaring nothing a milestone.
  const milestones = useProjectMilestones(workspaceSlug?.toString(), issueDetails?.project_id ?? undefined);
  const marked = Object.keys(milestones).length > 0 ? !!milestones[issueId] : undefined;
  const look = barLook(issueDetails, fill, stateDetails?.group, undefined, marked);
  // Inside the bar, not in the overlay. The overlay sits at zIndex 4 and the bars
  // above it: the fill was only ever visible through the 50% veil that used to
  // cover every bar, and removing that veil made it invisible outright.
  const percent = useProjectProgress(issueId);
  /**
   * Work that has left the plan, drawn distinctly — and only when the reader has
   * asked for it.
   *
   * Finished used to be a 55% veil of the surface colour over the bar, which is
   * the obvious move and is wrong twice over: it makes the colour-by choice
   * unreadable exactly where it is most useful ("who finished what"), and on the
   * dark theme a faded bar and a pale series colour are the same picture. A 45°
   * hatch in the bar's OWN colour plus a tick says the same thing, keeps the
   * series legible, and survives a greyscale print.
   *
   * Cancelled used to be drawn as finished — same hatch, same tick — because
   * `barLook` answered `done` for either state group. It has its own treatment
   * now: no fill at all, its series colour as an outline, the label struck
   * through and a ✕ instead of the tick. The reasoning, and why the other three
   * state groups are deliberately drawn plain, is at the bottom of `palette.ts`.
   * This chart and the portfolio draw it identically, on purpose.
   */
  // Named for what it governs rather than for the store key: `showCompleted` now
  // decides both treatments. (`marked` is already taken two lines up, and means
  // something else entirely — whether this item is a marked deliverable.)
  const markClosed = colors?.showCompleted ?? false;
  const showDone = !!look.done && markClosed;
  const showCancelled = !!look.cancelled && markClosed;
  const style = colorOverride ? { ...blockStyle, backgroundColor: colorOverride } : blockStyle;
  const barStyle = showCancelled
    ? { ...style, ...cancelledFill(fill) }
    : showDone
      ? { ...style, backgroundImage: completedFill(fill) }
      : style;

  const handleIssuePeekOverview = () => handleRedirection(workspaceSlug, issueDetails, isMobile);

  const handleBlockKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space would scroll the timeline otherwise
    if (e.key === " ") e.preventDefault();
    handleIssuePeekOverview();
  };

  const duration = findTotalDaysInRange(issueDetails?.start_date, issueDetails?.target_date) || 0;

  return (
    <Popover delay={100} openOnHover>
      <Popover.Button
        className="w-full"
        render={
          <div
            id={`issue-${issueId}`}
            className="space-between relative flex h-full w-full cursor-pointer items-center rounded-sm"
            // A one-day item is drawn as a diamond by the overlay. The bar behind it
            // is a 3px sliver poking out from under the marker, which reads as a
            // rendering fault — so it steps aside and leaves the shape to the diamond.
            // The cancelled outline steps aside with it, for the same reason: a 2px
            // box drawn around a 3px sliver is not an outline, it is a smudge.
            style={look.milestone ? { ...barStyle, backgroundColor: "transparent", border: undefined } : barStyle}
            // a real button element would restyle the bar (UA text-align/appearance) and cannot legally wrap these divs
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="button"
            tabIndex={0}
            onClick={handleIssuePeekOverview}
            onKeyDown={handleBlockKeyDown}
          >
            {/* A finished bar steps back rather than shouting: what is left to do is
                the part of a plan you read. Overdue does the opposite. */}
            {/* Not on a cancelled bar: the whole point of taking the fill away is
                that an abandoned item stops claiming area, and a progress shade
                is area. How far something got before it was dropped is a fact for
                the panel, not for the plan. */}
            {!showCancelled && percent > 0 && percent < 100 && (
              <div
                className="pointer-events-none absolute top-0 left-0 h-full rounded-l-sm bg-black/25"
                style={{ width: `${percent}%` }}
                title={`${percent}% of its sub-items are done`}
              />
            )}
            {/* The veil that used to sit here is gone: it drained every colour-by
                palette to pastel and, on the dark theme, made a finished bar and a
                pale series colour the same picture. The hatch on `barStyle` and
                the tick beside the title say it instead. A finished bar with the
                toggle OFF is drawn exactly like any other, which is the point of
                the toggle. */}
            {look.overdue && (
              <div
                className="ring-danger-primary pointer-events-none absolute top-0 left-0 h-full w-full rounded-sm ring-2 ring-inset"
                title="Past its due date and not finished"
              />
            )}
            <div
              className={
                showCancelled
                  ? // No fill left to read against, so the label takes the
                    // ordinary text token — the one pairing this product has
                    // already contrast-checked against both surfaces — and the
                    // line through it is the channel that says "cancelled"
                    // outright rather than by inference.
                    "sticky w-auto flex-1 truncate overflow-hidden px-2.5 py-1 text-13 text-primary line-through decoration-1"
                  : "sticky w-auto flex-1 truncate overflow-hidden px-2.5 py-1 text-13"
              }
              // Chosen against the bar's own fill, done or not: the hatch keeps the
              // bar's own colour, so the contrast decision is the same one. The
              // `look.done ? undefined` that used to be here existed for the veil.
              style={{ left: `${sidebarPaneWidth}px`, color: showCancelled ? undefined : look.text }}
            >
              {/* The glyph, not only the texture. A hatch is invisible on a
                  three-day bar and gone entirely in a greyscale print — and a ✕
                  says the opposite thing from a ✓, which is why cancelled work
                  stopped sharing the tick. */}
              {showCancelled ? (
                <span aria-hidden>{CANCELLED_GLYPH} </span>
              ) : (
                showDone && <span aria-hidden>{DONE_GLYPH} </span>
              )}
              {issueDetails?.name}
            </div>
            {isEpic && (
              <IssueStats
                issueId={issueId}
                className="sticky mx-2 w-auto flex-shrink-0 justify-end truncate overflow-hidden font-medium text-primary"
                showProgressText={duration >= 2}
              />
            )}
          </div>
        }
      />
      <Popover.Panel side="bottom" align="start">
        <>
          {issueDetails && issueDetails?.project_id && (
            <WorkItemPreviewCard
              projectId={issueDetails.project_id}
              stateDetails={{
                id: issueDetails.state_id ?? undefined,
              }}
              workItem={issueDetails}
            />
          )}
        </>
      </Popover.Panel>
    </Popover>
  );
});

// rendering issues on gantt sidebar
export const IssueGanttSidebarBlock = observer(function IssueGanttSidebarBlock(props: Props) {
  const { issueId, isEpic = false } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const storeType = useIssueStoreType() as GanttStoreType;
  const { issuesFilter } = useIssues(storeType);
  const { getProjectIdentifierById } = useProject();
  // ARRIBADA: the row's state, so the "Work items" column can carry a status colour —
  // otherwise a group reading "73%" gives no way to see WHICH rows are done.
  const { getProjectStates } = useProjectState();

  // handlers
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const projectIdentifier = getProjectIdentifierById(issueDetails?.project_id);
  // ARRIBADA: a completed state's own colour is green in the default set, so a dot in this
  // colour reads as "green when done" while staying correct for every other state group and
  // for any custom palette a workspace has set.
  const stateDetails =
    issueDetails && getProjectStates(issueDetails.project_id)?.find((state) => state?.id == issueDetails.state_id);

  const handleIssuePeekOverview = (e: any) => {
    e.stopPropagation(true);
    e.preventDefault();
    handleRedirection(workspaceSlug, issueDetails, isMobile);
  };

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetails?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetails?.sequence_id,
    isEpic,
  });

  return (
    <ControlLink
      id={`issue-${issueId}`}
      href={workItemLink}
      onClick={handleIssuePeekOverview}
      className="line-clamp-1 w-full cursor-pointer text-13 text-primary"
      disabled={!!issueDetails?.tempId}
    >
      <div className="relative flex h-full w-full cursor-pointer items-center gap-2">
        {/* ARRIBADA: status dot in the row's state colour (green when the state is a
            completed one), so "which of these is done?" is answerable at a glance. */}
        {stateDetails?.color && (
          <Tooltip tooltipContent={stateDetails.name} isMobile={isMobile}>
            <span
              className="size-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: stateDetails.color }}
              aria-label={`State: ${stateDetails.name}`}
            />
          </Tooltip>
        )}
        {issueDetails?.project_id && (
          <IssueIdentifier
            issueId={issueDetails.id}
            projectId={issueDetails.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={issuesFilter?.issueFilters?.displayProperties}
          />
        )}
        <Tooltip tooltipContent={issueDetails?.name} isMobile={isMobile}>
          <span className="flex-grow truncate text-13 font-medium">{issueDetails?.name}</span>
        </Tooltip>
      </div>
    </ControlLink>
  );
});
