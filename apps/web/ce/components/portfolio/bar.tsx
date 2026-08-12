/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useGanttColorScale } from "@/plane-web/components/gantt-chart/color-scale";
import { CANCELLED_GLYPH, cancelledFill, completedFill, DONE_GLYPH } from "@/plane-web/components/gantt-chart/palette";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import type { TItemAssignee, TPortfolioColorBy } from "@/plane-web/types/arribada";
import { isItemCancelled, isItemDone, isProjectDone, portfolioRowColor } from "./color";
import { projectColor, readableTextColor } from "./colors";

type Props = { blockId: string };

// Small assignee avatars at the end of an item bar (Asana/Instagantt style).
const ItemAvatars = ({ assignees }: { assignees: TItemAssignee[] }) => {
  if (!assignees?.length) return null;
  const shown = assignees.slice(0, 3);
  return (
    <span className="ml-auto flex flex-shrink-0 items-center -space-x-1 pl-1">
      {shown.map((a) => (
        <span
          key={a.id}
          title={a.name}
          className="flex size-4 items-center justify-center overflow-hidden rounded-full border border-white/70 text-[9px] leading-none font-semibold text-white"
          style={a.avatar ? undefined : { backgroundColor: projectColor(a.id) }}
        >
          {a.avatar ? <img src={a.avatar} alt="" className="size-full object-cover" /> : a.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {assignees.length > 3 && (
        <span className="bg-neutral-700 flex size-4 items-center justify-center rounded-full border border-white/70 text-[8px] font-semibold text-white">
          +{assignees.length - 3}
        </span>
      )}
    </span>
  );
};

// The bar drawn inside a gantt slot. Projects get a bold summary bar; a project
// bar whose dates are only DERIVED from its tasks (no plan entered) is drawn
// hatched to say "this is inferred, not committed".
export const PortfolioBar = observer(function PortfolioBar({ blockId }: Props) {
  const portfolio = usePortfolio();
  const { workspaceSlug } = useParams();
  const { setPeekIssue } = useIssueDetail();
  const { getStateById } = useProjectState();
  // Null when the board has not mounted a provider, which is what every chart
  // that has not opted in gets — those keep painting exactly what they painted
  // before rather than falling over.
  const colors = useGanttColorScale();
  // Folder-header rows span the row with no bar (Asana section-header style).
  if (portfolio.isFolderRow(blockId)) return null;
  const isProject = portfolio.isProjectRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);

  // Which value this row has on the colour-by axis, and therefore which of the
  // six validated hues it takes. A project row on a work-item axis short-circuits
  // to the neutral inside portfolioRowColor — it is not "unassigned", it is a row
  // that is not on that axis at all. See color.ts.
  const color = portfolioRowColor(
    portfolio.colorBy as TPortfolioColorBy,
    { isProject, projectId: portfolio.getRowProjectId(blockId), item },
    (key) => colors?.scale.colorOf(key) ?? "#94a3b8",
    { getState: getStateById }
  );

  /**
   * Work that has left the plan, drawn distinctly — and only when the reader has
   * asked for it.
   *
   * Two states, two treatments, neither of them a colour. Done-ness and
   * cancelled-ness are STATES: giving either a hue would eat a palette slot and
   * collide with whichever series happened to own that colour, and both survive
   * a greyscale print this way, which a faded bar does not. See the note on the
   * five state groups at the bottom of `palette.ts` for why the other three get
   * nothing.
   *
   * A PROJECT row can only be finished, never cancelled: its done-ness is
   * counted from its work items (`completed_item_count`) and a project has no
   * state of its own to be cancelled in.
   */
  // Named for what it governs rather than for the store key: `showCompleted` now
  // decides both treatments, and off still means every bar is drawn plain.
  const markClosed = colors?.showCompleted ?? false;
  const isDone = markClosed
    ? isProject
      ? isProjectDone(project)
      : !!item && isItemDone(item, { getState: getStateById })
    : false;
  const isCancelled = markClosed && !isProject && !!item && isItemCancelled(item, { getState: getStateById });

  /**
   * Dates inferred from the work items rather than planned. Its own texture, and
   * it must not be the SAME texture as "done" — two diagonals at 45° would say
   * two different things on one board. Done keeps 45° because that is the rule on
   * both boards; the older derived hatch moves to 135°, and the legend names both.
   */
  const isDerived = isProject && !project?.start_date && !project?.target_date;
  const label = isProject ? project?.name : item?.name;
  const textColor = readableTextColor(color);
  const isCritical = !isProject && portfolio.isCriticalIssue(blockId);

  // % complete for the project summary bar (drawn as a bottom progress line).
  const pct =
    isProject && project?.item_count ? Math.round(((project.completed_item_count ?? 0) / project.item_count) * 100) : 0;

  // Item bars open the peek panel. This board IS draggable now, so the reason a
  // drag does not also open the peek is no longer "nothing drags here" — it is
  // ChartDraggable, which puts `pointer-events-none` on the wrapper the moment a
  // drag starts moving. The mouseup then lands on the wrapper rather than on this
  // button, so no click event is synthesised. A stationary press still clicks,
  // which is the behaviour wanted.
  const openPeek = () => {
    const pid = portfolio.getRowProjectId(blockId);
    if (workspaceSlug && pid)
      setPeekIssue({ workspaceSlug: workspaceSlug.toString(), projectId: pid, issueId: blockId });
  };

  const bar = (
    <div
      className={cn("relative flex w-full items-center gap-1 overflow-hidden rounded px-2", {
        "shadow-sm h-[26px] font-medium": isProject,
        "h-[18px]": !isProject,
        "ring-2 ring-danger-strong": isCritical,
      })}
      style={
        isCancelled
          ? // Cancelled wins outright, and it wins by taking the fill AWAY: a
            // bar with no area cannot overstate a plan. Its own derived hatch
            // would be a fill, so it goes with it — the outline says the extent.
            cancelledFill(color)
          : isDone
            ? // Done wins the fill; a derived bar that is also finished keeps its
              // outline, so the row still says where its dates came from.
              {
                backgroundImage: completedFill(color),
                border: isDerived ? `1px solid ${color}` : undefined,
              }
            : isDerived
              ? {
                  backgroundImage: `repeating-linear-gradient(135deg, ${color}, ${color} 5px, transparent 5px, transparent 10px)`,
                  border: `1px solid ${color}`,
                }
              : { backgroundColor: color }
      }
      title={isCancelled ? `${label} — cancelled` : isDone ? `${label} — finished` : undefined}
    >
      <span
        className={cn("relative z-10 truncate text-13 leading-none", {
          // The bar has no fill to read against any more, so the label takes the
          // ordinary text token — which is the one pairing this product has
          // already contrast-checked against both surfaces. The line through it
          // is the third channel, after the missing fill and the glyph, and it is
          // the only one that says "cancelled" in as many words.
          "text-primary line-through decoration-1": isCancelled,
        })}
        style={{ color: isCancelled || (isDerived && !isDone) ? undefined : textColor }}
      >
        {/* The glyph, not just the texture. A hatch is invisible on a 3px bar and
            gone entirely in a greyscale print; a tick survives both — and a ✕
            says the opposite thing from a ✓, which is the whole reason cancelled
            stopped sharing one. */}
        {isCancelled ? <span aria-hidden>{CANCELLED_GLYPH} </span> : isDone && <span aria-hidden>{DONE_GLYPH} </span>}
        {label}
      </span>
      {!isProject && item?.assignees && <ItemAvatars assignees={item.assignees} />}
      {isProject && project?.item_count ? (
        <span
          className="absolute bottom-0 left-0 h-[3px] rounded-full bg-white/75"
          style={{ width: `${pct}%` }}
          title={`${pct}% complete`}
        />
      ) : null}
    </div>
  );

  // Project summary bars are display-only; only item bars are a real control, so
  // they get a real <button> (Enter/Space then come for free) — text-left keeps the
  // label where the plain div used to put it.
  if (isProject) return <div className="flex h-full w-full items-center">{bar}</div>;

  return (
    <button type="button" className="flex h-full w-full cursor-pointer items-center text-left" onClick={openPeek}>
      {bar}
    </button>
  );
});
