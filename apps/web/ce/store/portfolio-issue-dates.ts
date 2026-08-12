/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The portfolio's copy of a work item and Plane's copy are two different objects,
 * and only one of them is written when somebody edits a date.
 *
 * The board expands a project by calling `getProjectItems`, which fills the
 * portfolio store's own `itemMap`; `getRowById` draws the bars from it. The peek
 * panel the board opens on a bar (`ce/components/portfolio/root.tsx`) is Plane's,
 * and its date pickers write through `issues.updateIssue` into
 * `rootStore.issue.issues.issuesMap`. Nothing joined the two, so the reported
 * behaviour was exactly right: the date saved, the server had it, and the bar did
 * not move until the project was collapsed and expanded again.
 *
 * This propagates the change rather than seeding a value. An id has to have been
 * seen in a previous snapshot before its dates are copied across, so a row that
 * the portfolio has just fetched is never overwritten by whatever an older peek
 * happened to leave in `issuesMap`. And because Plane's write is optimistic with a
 * rollback (`base-issues.store.ts:582-586` puts the old dates back when the PATCH
 * fails), the rollback propagates here by the same route — the bar follows the
 * click and then follows the refusal, which is the behaviour
 * `undated-items-modal.tsx:157-172` already has by hand.
 *
 * A whole-project refetch would have done the same job and cost a round trip per
 * keystroke on a date field. This costs a comparison over the rows on screen.
 */
import { comparer, reaction } from "mobx";
import type { RootStore } from "./root.store";

/** `start|target`, with the empty string standing in for null. One string per row
 *  so the structural comparison below is a string compare rather than a walk. */
const SEPARATOR = "|";

const stamp = (start: string | null | undefined, target: string | null | undefined): string =>
  `${start ?? ""}${SEPARATOR}${target ?? ""}`;

/**
 * Keep the portfolio's bars in step with date edits made through Plane's stores.
 *
 * Returns the disposer, which the root store has no use for — it lives as long as
 * the tab does — but which a test needs to stop one instance leaking into the next.
 */
export const mirrorIssueDatesIntoPortfolio = (root: RootStore): (() => void) =>
  reaction(
    () => {
      const { issuesMap } = root.issue.issues;
      const dates: Record<string, string> = {};
      // Only the rows the board is currently showing. `issuesMap` is every work
      // item touched anywhere this session; walking it all would make this cost
      // grow with how long the tab has been open rather than with what is drawn.
      for (const id of Object.keys(root.portfolio.itemMap)) {
        const issue = issuesMap[id];
        if (issue) dates[id] = stamp(issue.start_date, issue.target_date);
      }
      return dates;
    },
    (dates, previous) => {
      for (const [id, next] of Object.entries(dates)) {
        const before = previous?.[id];
        // Not in the last snapshot means this is the first time both stores have
        // held the row, which is not a change and must not be treated as one.
        if (before === undefined || before === next) continue;
        const item = root.portfolio.getItem(id);
        if (!item) continue;
        const [start, target] = next.split(SEPARATOR);
        const startDate = start || null;
        const targetDate = target || null;
        if ((item.start_date ?? null) === startDate && (item.target_date ?? null) === targetDate) continue;
        root.portfolio.applyItemDates(id, { start_date: startDate, target_date: targetDate });
      }
    },
    // Without this the effect would run on every keystroke anywhere in `issuesMap`,
    // because the data function returns a fresh object each time.
    { equals: comparer.structural }
  );
