/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The rubber-band line drawn while dragging a dependency from one gantt bar to
 * another. Rendered to <body> as a fixed, click-through overlay so it can span
 * the whole viewport regardless of the gantt's own scroll/overflow.
 */
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { ganttLinking } from "@/plane-web/store/gantt-linking";

export const GanttLinkPreview = observer(function GanttLinkPreview() {
  const line = ganttLinking.line;
  if (!line || typeof document === "undefined") return null;
  return createPortal(
    <svg
      className="pointer-events-none fixed inset-0 z-[9999] h-screen w-screen"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <circle cx={line.x2} cy={line.y2} r={4} fill="#3b82f6" />
    </svg>,
    document.body
  );
});
