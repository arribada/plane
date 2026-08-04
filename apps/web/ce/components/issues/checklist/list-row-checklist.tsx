/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The checklist badge on a list row.
 *
 * The list is the only view that gets this. A checklist is containment without
 * hierarchy, and a board, a calendar, a timeline or a spreadsheet all re-draw
 * the whole plan — putting members there would make containment look exactly
 * like the parent link this relation exists to avoid.
 *
 * So: a dropdown, not an expansion. It renders in a portal, which keeps the
 * member links out of the row's anchor (nested anchors are invalid) and keeps
 * the row's height fixed, which the virtualised list depends on.
 *
 * Rows that own nothing render nothing at all — not a greyed-out badge. An
 * affordance on every row would be the pollution the design rule forbids.
 */
import type { MouseEvent } from "react";
import { useState } from "react";
import { observer } from "mobx-react";
import { CheckSquare, Loader2, Square } from "lucide-react";
import { Popover } from "@plane/propel/popover";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn, generateWorkItemLink } from "@plane/utils";
import { useIssueChecklist } from "./use-checklist";

// The row itself is a link to the work item, so every click in here has to be
// stopped before the row's navigation handler ever sees it.
const swallow = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

type Props = {
  workspaceSlug: string | undefined;
  projectId: string | undefined;
  issueId: string;
};

export const ListRowChecklist = observer(function ListRowChecklist(props: Props) {
  const { workspaceSlug, projectId, issueId } = props;
  const checklist = useIssueChecklist(workspaceSlug, projectId, issueId);
  const [busyLine, setBusyLine] = useState<string | null>(null);

  const total = checklist.items.length;
  if (!workspaceSlug || !projectId || total === 0) return null;

  const done = checklist.items.filter((row) => row.done).length;

  const toggle = async (event: MouseEvent, lineId: string) => {
    swallow(event);
    const item = checklist.items.find((row) => row.id === lineId);
    if (!item || busyLine) return;
    setBusyLine(lineId);
    try {
      await checklist.toggle(item, !item.done);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't change that work item",
        message: (error as { error?: string })?.error ?? "It was left as it was.",
      });
    } finally {
      setBusyLine(null);
    }
  };

  return (
    <Popover>
      <Popover.Button
        onClick={swallow}
        aria-label={`Checklist, ${done} of ${total} done`}
        className={cn(
          "flex flex-shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-10 text-tertiary",
          "hover:bg-layer-1 hover:text-secondary"
        )}
      >
        <CheckSquare className="size-3" />
        {done}/{total}
      </Popover.Button>

      <Popover.Panel
        side="bottom"
        align="start"
        className="shadow-lg z-[15] max-h-72 w-80 overflow-y-auto rounded-lg border border-subtle bg-surface-1 p-2"
      >
        <p className="mb-1 px-1 text-10 tracking-wide text-tertiary uppercase">Checklist</p>
        <ul className="flex flex-col gap-0.5">
          {checklist.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-layer-1">
              <button
                type="button"
                onClick={(event) => void toggle(event, item.id)}
                aria-pressed={item.done}
                aria-label={item.done ? `Reopen ${item.name}` : `Complete ${item.name}`}
                className="flex-shrink-0 text-tertiary hover:text-accent-primary"
              >
                {busyLine === item.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : item.done ? (
                  <CheckSquare className="size-3.5 text-accent-primary" />
                ) : (
                  <Square className="size-3.5" />
                )}
              </button>
              <a
                href={generateWorkItemLink({
                  workspaceSlug,
                  projectId: item.project_id,
                  issueId: item.issue_id,
                  projectIdentifier: item.project_identifier,
                  sequenceId: item.sequence_id,
                })}
                onClick={(event) => event.stopPropagation()}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-12 text-primary hover:text-accent-primary hover:underline"
              >
                <span className="flex-shrink-0 text-10 text-tertiary">
                  {item.project_identifier}-{item.sequence_id}
                </span>
                <span className={cn("truncate", { "text-tertiary line-through": item.done })}>{item.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </Popover.Panel>
    </Popover>
  );
});
