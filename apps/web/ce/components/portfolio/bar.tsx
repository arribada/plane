/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import type { TItemAssignee } from "@/plane-web/types/arribada";
import { PRIORITY_COLOR, projectColor, readableTextColor } from "./colors";

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
  // Folder-header rows span the row with no bar (Asana section-header style).
  if (portfolio.isFolderRow(blockId)) return null;
  const isProject = portfolio.isProjectRow(blockId);
  const project = portfolio.getProject(blockId);
  const item = portfolio.getItem(blockId);

  let color = "#94a3b8";
  if (portfolio.colorBy === "project") {
    const pid = portfolio.getRowProjectId(blockId);
    if (pid) color = projectColor(pid);
  } else {
    // priority
    color = isProject ? "#64748b" : PRIORITY_COLOR[item?.priority ?? "none"];
  }

  const isDerived = isProject && !project?.start_date && !project?.target_date;
  const label = isProject ? project?.name : item?.name;
  const textColor = readableTextColor(color);
  const isCritical = !isProject && portfolio.isCriticalIssue(blockId);

  // % complete for the project summary bar (drawn as a bottom progress line).
  const pct =
    isProject && project?.item_count ? Math.round(((project.completed_item_count ?? 0) / project.item_count) * 100) : 0;

  // Item bars open the peek panel. Safe as a plain onClick: the portfolio passes no
  // enableBlockMove, so the gantt wrapper's drag handlers never swallow the click.
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
        "ring-red-500 ring-2": isCritical,
      })}
      style={
        isDerived
          ? {
              backgroundImage: `repeating-linear-gradient(45deg, ${color}, ${color} 5px, transparent 5px, transparent 10px)`,
              border: `1px solid ${color}`,
            }
          : { backgroundColor: color }
      }
    >
      <span
        className="relative z-10 truncate text-13 leading-none"
        style={{ color: isDerived ? undefined : textColor }}
      >
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
