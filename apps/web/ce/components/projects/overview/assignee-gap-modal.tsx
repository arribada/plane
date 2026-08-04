/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Put somebody on every open work item that has nobody, in one pass.
 *
 * Rows arrive pre-filled when the item's discipline has exactly one holder on
 * this project — the same rule the discipline field uses, read the other way
 * round. Two holders is a decision, so those rows stay blank rather than having
 * one picked for them.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { GapModalShell } from "./gap-modal-shell";

const service = new ArribadaService();

type TItem = {
  id: string;
  name: string;
  sequence_id: number;
  start_date: string | null;
  target_date: string | null;
  role: string | null;
  suggested: string | null;
};
type TMember = { id: string; name: string; email: string };

type Props = { isOpen: boolean; onClose: () => void; onDone: () => void };

export const AssigneeGapModal = observer(function AssigneeGapModal({ isOpen, onClose, onDone }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const [items, setItems] = useState<TItem[] | null>(null);
  const [members, setMembers] = useState<TMember[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspaceSlug || !projectId) return;
    let live = true;
    setItems(null);
    const load = async () => {
      try {
        const data = await service.getAssigneeGap(workspaceSlug.toString(), projectId.toString());
        if (!live) return;
        setItems(data.items);
        setMembers(data.members);
        setChoice(Object.fromEntries(data.items.filter((i) => i.suggested).map((i) => [i.id, i.suggested!])));
      } catch {
        if (live) setItems([]);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [isOpen, workspaceSlug, projectId]);

  const filled = Object.values(choice).filter(Boolean).length;

  const save = async () => {
    if (!workspaceSlug || !projectId || filled === 0) return;
    setSaving(true);
    try {
      const result = await service.setAssigneeGap(workspaceSlug.toString(), projectId.toString(), choice);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${result.written} staffed`,
        message: "They now show up in the assignee's own list of work.",
      });
      onDone();
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save",
        message: (error as { error?: string })?.error ?? "Nothing was changed.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <GapModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Put somebody on these"
      blurb="Rows already showing a name took it from the item's discipline, because exactly one person on this project holds it. Nothing is saved until you press the button."
      count={items?.length ?? null}
      emptyMessage="Every open work item has somebody on it."
      filled={filled}
      saving={saving}
      onSave={() => void save()}
      saveLabel="Assign"
    >
      <ul className="space-y-1.5">
        {(items ?? []).map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-13 text-primary" title={item.name}>
              {item.name}
            </span>
            {/* The discipline, when there is one: it is the reason a name was
                suggested, and without it the suggestion looks arbitrary. */}
            <span className="flex-shrink-0 text-11 text-tertiary">
              {item.role ?? "no discipline"}
              {item.target_date ? ` · due ${renderFormattedDate(item.target_date)}` : ""}
            </span>
            <select
              value={choice[item.id] ?? ""}
              onChange={(e) => setChoice((c) => ({ ...c, [item.id]: e.target.value }))}
              aria-label={`Assignee for ${item.name}`}
              className="w-44 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
            >
              <option value="">Leave unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </GapModalShell>
  );
});
