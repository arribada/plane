/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Transient rubber-band line shown while dragging a dependency from one bar to
 * another. Screen coordinates (the preview is a fixed full-viewport overlay).
 */
import { action, makeObservable, observable } from "mobx";

class GanttLinkingStore {
  line: { x1: number; y1: number; x2: number; y2: number } | null = null;

  constructor() {
    makeObservable(this, { line: observable.ref, setLine: action, clear: action });
  }

  setLine(l: { x1: number; y1: number; x2: number; y2: number }): void {
    this.line = l;
  }

  clear(): void {
    this.line = null;
  }
}

export const ganttLinking = new GanttLinkingStore();
