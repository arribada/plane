/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { PRIORITY_COLOR, projectColor, readableTextColor } from "./colors";

type Props = { blockId: string };

// The bar drawn inside a gantt slot. Projects get a bold summary bar; a project
// bar whose dates are only DERIVED from its tasks (no plan entered) is drawn
// hatched to say "this is inferred, not committed".
export const PortfolioBar = observer(function PortfolioBar({ blockId }: Props) {
  const portfolio = usePortfolio();
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

  return (
    <div className="flex h-full w-full items-center">
      <div
        className={cn("relative flex w-full items-center overflow-hidden rounded px-2", {
          "h-[26px] font-medium shadow-sm": isProject,
          "h-[18px]": !isProject,
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
        <span className="truncate text-13 leading-none" style={{ color: isDerived ? undefined : textColor }}>
          {label}
        </span>
      </div>
    </div>
  );
});
