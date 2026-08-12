/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Freeze the plan.
 *
 * A timeline is easy to move by accident: a bar is a drag target the whole time
 * it is on screen, and a plan that has been agreed with a funder should not be
 * one stray gesture away from saying something different. Locking is the answer
 * to "we have committed to this", not to "I do not trust you".
 *
 * Which is why it applies to the lead too, and why the button says so rather
 * than greying itself out for everybody else: a lock its owner can ignore by
 * accident is not a lock.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { ChevronDown, Lock, LockOpen } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { apiErrorMessage, apiErrorStatus } from "@/plane-web/services/api-error";
import type { TPlanLock, TPlanLockWrite } from "./use-plan-lock";

const REFUSED = "Only the project lead can change this.";

export const GanttLockButton = observer(function GanttLockButton({ lock }: { lock: TPlanLock }) {
  const [open, setOpen] = useState(false);
  if (!lock.loaded) return null;

  /**
   * Say what actually happened.
   *
   * This announced "Only the project lead can change this." for EVERY failure,
   * because a rejected write and a dropped connection arrived here as the same
   * bare `false`. A lead on bad wifi was told they were not the lead — about a
   * lock whose entire premise is that it applies to the lead too, so the message
   * was not merely wrong, it contradicted the feature. Only the statuses that
   * mean "you may not" get the permission wording now.
   */
  const guard = async (run: () => Promise<TPlanLockWrite>, verb: string) => {
    const result = await run();
    if (result.ok) return;
    const status = apiErrorStatus(result.error);
    setToast({
      type: TOAST_TYPE.ERROR,
      title: `Couldn't ${verb}`,
      message:
        status === 403 || status === 401
          ? REFUSED
          : apiErrorMessage(result.error, "The setting was left as it was. Try again."),
    });
  };

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() =>
          void guard(() => lock.setLocked(!lock.locked), lock.locked ? "unlock the plan" : "lock the plan")
        }
        aria-pressed={lock.locked}
        title={
          lock.locked
            ? "The plan is frozen: nothing can be dragged, resized or added from the timeline. This applies to you too."
            : "Freeze the plan so nothing can be dragged, resized or added from the timeline."
        }
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-l-md border px-2 text-11 font-medium transition-colors",
          lock.locked
            ? "border-warning-primary/40 bg-warning-component-surface-medium text-warning-primary"
            : "border-subtle text-secondary hover:bg-layer-2 hover:text-primary"
        )}
      >
        {lock.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
        {lock.locked ? "Locked" : "Lock"}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Who may change this plan"
        aria-expanded={open}
        className="flex h-7 items-center rounded-r-md border border-l-0 border-subtle px-1 text-secondary hover:bg-layer-2 hover:text-primary"
      >
        <ChevronDown className="size-3" />
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          {/* `whitespace-normal`: inherited nowrap from the toolbar group would
              forbid these sentences from wrapping. See group-by.tsx. */}
          <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-72 rounded-md border border-subtle bg-layer-1 p-2 break-words whitespace-normal">
            <p className="px-1 pb-1 text-10 font-medium tracking-wide text-tertiary uppercase">
              Who may change this plan
            </p>
            {[
              {
                key: "others" as const,
                on: lock.allowEditOthers,
                label: "Anyone may edit any item",
                hint: "Off: only an item's own assignees and the lead can move it.",
                run: () => lock.setAllowEditOthers(!lock.allowEditOthers),
                verb: "change who may edit",
              },
              {
                key: "add" as const,
                on: lock.allowAddItems,
                label: "Anyone may add items",
                hint: "Off: the scope is closed; only the lead adds work.",
                run: () => lock.setAllowAddItems(!lock.allowAddItems),
                verb: "change who may add",
              },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => void guard(option.run, option.verb)}
                className="flex w-full items-start gap-2 rounded p-1.5 text-left hover:bg-layer-2"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-7 flex-shrink-0 items-center rounded-full px-0.5 transition-colors",
                    option.on ? "bg-accent-primary" : "bg-layer-2"
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "size-3 rounded-full bg-surface-1 transition-transform",
                      option.on && "translate-x-3"
                    )}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-12 text-primary">{option.label}</span>
                  <span className="block text-10 text-tertiary">{option.hint}</span>
                </span>
              </button>
            ))}
            {lock.locked && (
              <p className="mt-1 border-t border-subtle px-1 pt-1.5 text-10 text-warning-primary">
                The plan is locked, so neither of these applies until it is unlocked.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
});
