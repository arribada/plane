/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import type { IGanttBlock } from "@plane/types";
import { DependencyHandle } from "./handle";

type RightDependencyDraggableProps = {
  block: IGanttBlock;
  ganttContainerRef: RefObject<HTMLDivElement>;
};

export function RightDependencyDraggable(props: RightDependencyDraggableProps) {
  return <DependencyHandle blockId={props.block.id} side="right" />;
}
