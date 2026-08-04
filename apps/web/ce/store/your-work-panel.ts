/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Whether the right-hand panel on Your work is showing. A tiny MobX singleton
 * (no root-store wiring), same shape as the gantt display preference: the layout
 * reads it, one header button flips it.
 *
 * Deliberately NOT the existing `profileSidebarCollapsed` in the theme store.
 * That flag is driven by a resize handler which forces the panel open at every
 * width above 768px, so a desktop user cannot close it — which is exactly the
 * complaint. Reusing it would mean either fighting that handler on every render
 * or removing it and taking the mobile overlay behaviour down with it. This is
 * one boolean about one panel, and it only governs the desktop instance.
 */
import { action, makeObservable, observable } from "mobx";

const STORAGE_KEY = "arribada.your-work.panel";

class YourWorkPanelStore {
  /** Hidden, not "collapsed": there is no half state, and defaulting to false
   *  keeps the page looking exactly as it did for anybody who never asks. */
  hidden = false;

  constructor() {
    makeObservable(this, {
      hidden: observable.ref,
      toggle: action,
      setHidden: action,
    });
    this.restore();
  }

  toggle = (): void => {
    this.setHidden(!this.hidden);
  };

  setHidden = (value: boolean): void => {
    this.hidden = value;
    this.persist();
  };

  /** Both sides best-effort: localStorage is unavailable in some privacy modes,
   *  and a panel preference is not worth an exception. */
  private restore() {
    try {
      this.hidden = localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // keep the default
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.hidden));
    } catch {
      // session-only
    }
  }
}

export const yourWorkPanel = new YourWorkPanelStore();
