/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Whether this project's plan may be moved, and by whom.
 *
 * Three settings, all permissive by default, because a tool that starts by
 * forbidding things is one people route around. They earn their keep the moment
 * a plan stops being a draft: a lead about to show a funder a timeline needs to
 * know it will still say the same thing tomorrow.
 *
 * The lock is deliberately NOT a permission. It applies to the lead too, because
 * it means "this plan is agreed", not "you specifically may not" — and a lock
 * its owner can ignore by accident is not a lock.
 */
import { useCallback, useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

/**
 * What became of one of these writes.
 *
 * A bare `false` was the whole answer, and the button above it turned every
 * `false` into "Only the project lead can change this." — the likely reason, and
 * a flat lie on a dropped connection. The rejection itself has to travel so the
 * caller can tell a refusal from an outage.
 */
export type TPlanLockWrite = { ok: true } | { ok: false; error: unknown };

export type TPlanLock = {
  locked: boolean;
  allowEditOthers: boolean;
  allowAddItems: boolean;
  /** Whether this project's plan has been made the lead's. */
  leadOnlyEdits: boolean;
  /**
   * Whether THIS user may change the plan. The server's own answer, carried on
   * the schedule payload — not `!leadOnlyEdits || amILead` worked out here.
   *
   * The reason is the whole point of the setting: the same predicate decides the
   * 403, so a control drawn on the strength of this is a control the server will
   * serve. A client that recomputed it would be a second definition of one
   * permission, and the second definition is always the one that lies.
   */
  canEditPlan: boolean;
  /** Null until the settings have loaded — callers must not read the flags yet. */
  loaded: boolean;
  setLocked: (next: boolean) => Promise<TPlanLockWrite>;
  setAllowEditOthers: (next: boolean) => Promise<TPlanLockWrite>;
  setAllowAddItems: (next: boolean) => Promise<TPlanLockWrite>;
  setLeadOnlyEdits: (next: boolean) => Promise<TPlanLockWrite>;
};

export function usePlanLock(workspaceSlug: string | undefined, projectId: string | undefined): TPlanLock {
  const [locked, setLockedState] = useState(false);
  const [allowEditOthers, setAllowEditOthersState] = useState(true);
  const [allowAddItems, setAllowAddItemsState] = useState(true);
  const [leadOnlyEdits, setLeadOnlyEditsState] = useState(false);
  const [canEditPlan, setCanEditPlanState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    let live = true;
    const load = async () => {
      try {
        const schedule = await service.getSchedule(workspaceSlug, projectId);
        if (!live) return;
        setLockedState(!!schedule?.timeline_locked);
        // `?? true` rather than `!!`: the field is optional on the type, and a
        // backend that has not been redeployed yet must not read as "forbidden".
        setAllowEditOthersState(schedule?.allow_edit_others ?? true);
        setAllowAddItemsState(schedule?.allow_add_items ?? true);
        setLeadOnlyEditsState(!!schedule?.lead_only_edits);
        setCanEditPlanState(schedule?.can_edit_plan ?? true);
      } catch {
        // A settings call that fails must not silently lock the board. Failing
        // open is the right default here: the server still enforces every write.
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId]);

  const setLocked = useCallback(
    async (next: boolean): Promise<TPlanLockWrite> => {
      if (!workspaceSlug || !projectId) return { ok: false, error: undefined };
      // Optimistic, then corrected: the toggle is the one control whose effect
      // has to be instant, and the server rejects a non-lead anyway.
      setLockedState(next);
      try {
        const saved = await service.updateSchedule(workspaceSlug, projectId, { timeline_locked: next });
        setLockedState(!!saved?.timeline_locked);
        return { ok: true };
      } catch (error) {
        setLockedState(!next);
        return { ok: false, error };
      }
    },
    [workspaceSlug, projectId]
  );

  /** One writer for all three: same optimistic-then-corrected shape, same
   *  server-side lead check, so they cannot drift apart. */
  const write = useCallback(
    async (
      field: "timeline_locked" | "allow_edit_others" | "allow_add_items" | "lead_only_edits",
      next: boolean,
      apply: (value: boolean) => void
    ): Promise<TPlanLockWrite> => {
      if (!workspaceSlug || !projectId) return { ok: false, error: undefined };
      apply(next);
      try {
        const saved = await service.updateSchedule(workspaceSlug, projectId, { [field]: next });
        apply(!!(saved as Record<string, unknown>)?.[field]);
        return { ok: true };
      } catch (error) {
        apply(!next);
        return { ok: false, error };
      }
    },
    [workspaceSlug, projectId]
  );

  const setAllowEditOthers = useCallback(
    (next: boolean) => write("allow_edit_others", next, setAllowEditOthersState),
    [write]
  );
  const setAllowAddItems = useCallback(
    (next: boolean) => write("allow_add_items", next, setAllowAddItemsState),
    [write]
  );
  const setLeadOnlyEdits = useCallback(
    async (next: boolean) => {
      const result = await write("lead_only_edits", next, setLeadOnlyEditsState);
      // Only the lead can flip this, so whoever just did may still edit the plan.
      // Said explicitly rather than left to the next fetch: the controls this
      // gates are on screen, and re-rendering them as forbidden for a moment is
      // exactly the flicker that makes a permission look broken.
      if (result.ok) setCanEditPlanState(true);
      return result;
    },
    [write]
  );

  return {
    locked,
    allowEditOthers,
    allowAddItems,
    leadOnlyEdits,
    canEditPlan,
    loaded,
    setLocked,
    setAllowEditOthers,
    setAllowAddItems,
    setLeadOnlyEdits,
  };
}
