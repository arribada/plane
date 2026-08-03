/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which discipline this work item belongs to.
 *
 * Separate from the assignee because they are two answers to the same question
 * at different times: early on you know the discipline and not the person, later
 * you know the person and the discipline follows. Separate from Plane's project
 * role because that is a permission level — admin, member, guest — and says
 * nothing about whether somebody builds enclosures or writes firmware.
 *
 * It is also what every money and capacity figure in this fork is keyed on: a
 * rate belongs to a trade, not to a task, so an item with no discipline has no
 * cost no matter how many days it spans.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Hammer, Loader2 } from "lucide-react";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

export const IssueRoleField = observer(function IssueRoleField(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const [role, setRole] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId || !issueId) return;
    let live = true;
    const load = async () => {
      try {
        const data = await service.getIssueRole(workspaceSlug, projectId, issueId);
        if (!live) return;
        setRole(data.role);
        setOptions(data.options ?? []);
      } catch {
        // A field that will not load must not break the panel it sits in.
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId, issueId]);

  if (!loaded) return null;

  const commit = async (next: string) => {
    const previous = role;
    setRole(next || null);
    setBusy(true);
    try {
      const saved = await service.setIssueRole(workspaceSlug, projectId, issueId, next || null);
      setRole(saved.role);
      if (saved.assigned) {
        // Say so rather than letting an assignee appear on its own. A tool that
        // staffs work silently is one people stop trusting with staffing.
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Assigned from the roster",
          message: "One person on this project holds that discipline, so the item went to them.",
        });
      }
    } catch (error) {
      setRole(previous);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't set the discipline",
        message: (error as { error?: string })?.error ?? "It was not changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    // The shared row rather than a hand-rolled one: Plane's properties are laid
    // out by this component, and building a second layout beside it is exactly
    // why these two fields did not line up with the rest of the panel.
    <SidebarPropertyListItem icon={Hammer} label="Discipline">
      <div className="flex w-full items-center gap-1.5">
        <select
          disabled={!isEditable || busy}
          value={role ?? ""}
          onChange={(e) => void commit(e.target.value)}
          aria-label="Discipline this work item belongs to"
          className={cn(
            "min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-body-xs-regular outline-none",
            role ? "text-primary" : "text-tertiary",
            isEditable && "hover:border-subtle focus:border-accent-strong"
          )}
        >
          <option value="">None</option>
          {/* A stored value the roster no longer offers still has to render, or
              the select would silently show a different discipline. */}
          {(role && !options.includes(role) ? [role, ...options] : options).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {busy && <Loader2 className="size-3 shrink-0 animate-spin text-tertiary" />}
      </div>
    </SidebarPropertyListItem>
  );
});
