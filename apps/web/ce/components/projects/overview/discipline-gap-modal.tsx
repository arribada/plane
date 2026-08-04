/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Fix every item missing a discipline, in one place.
 *
 * The warning that opens this used to navigate to the work item list, which is a
 * correction promised and a navigation delivered: seven items meant opening seven
 * panels. A warning that names a number should hand back the rows behind it.
 *
 * Rows arrive pre-filled with what their assignee already implies, so the common
 * case is a glance and a save rather than seven decisions. Pre-filled, not
 * pre-saved: nothing is written until the button is pressed.
 *
 * A discipline can also be created here. The moment you need one is the moment
 * you find a task that has no honest answer in the list, and sending somebody to
 * the team settings to invent a person before they can name a trade is how a
 * field ends up permanently blank. Creating one does not give it to anybody —
 * the Overview then says nobody covers it, which is the true state.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { GapModalShell } from "./gap-modal-shell";

const service = new ArribadaService();

type TGapItem = {
  id: string;
  name: string;
  sequence_id: number;
  start_date: string;
  target_date: string;
  suggested: string | null;
};

type Props = { isOpen: boolean; onClose: () => void; onDone: () => void };

export const DisciplineGapModal = observer(function DisciplineGapModal({ isOpen, onClose, onDone }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const [items, setItems] = useState<TGapItem[] | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!isOpen || !workspaceSlug || !projectId) return;
    let live = true;
    setItems(null);
    setAdding(false);
    setNewName("");
    const load = async () => {
      try {
        const data = await service.getDisciplineGap(workspaceSlug.toString(), projectId.toString());
        if (!live) return;
        setItems(data.items);
        setOptions(data.options);
        // Seeded from the suggestion, so a row whose assignee already answers the
        // question needs no interaction at all.
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

  const addDiscipline = async () => {
    const name = newName.trim();
    if (!workspaceSlug || !projectId || !name) return;
    try {
      const result = await service.createProjectDiscipline(workspaceSlug.toString(), projectId.toString(), name);
      setOptions(result.options);
      setNewName("");
      setAdding(false);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `"${result.name}" added`,
        message: "Nobody covers it yet — the Overview will say so until somebody does.",
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't add it",
        message: (error as { error?: string })?.error ?? "The discipline was not created.",
      });
    }
  };

  const save = async () => {
    if (!workspaceSlug || !projectId || filled === 0) return;
    setSaving(true);
    try {
      const result = await service.setDisciplineGap(workspaceSlug.toString(), projectId.toString(), choice);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${result.written} set`,
        message: result.assigned
          ? `${result.assigned} also went to the one person holding that discipline.`
          : "Their days can now be costed and staffed.",
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
      title="Set the missing discipline"
      blurb="A rate belongs to a trade, so an item with no discipline has no cost however many days it spans. Rows already showing a value took it from their assignee — nothing is saved until you press the button."
      count={items?.length ?? null}
      emptyMessage="Every dated item already has a discipline."
      filled={filled}
      saving={saving}
      onSave={() => void save()}
      filledNoun="given a discipline"
      footerExtra={
        adding ? (
          <div className="flex items-center gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addDiscipline();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="e.g. Optics"
              aria-label="Name of the new discipline"
              className="w-40 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
            />
            <button
              type="button"
              onClick={() => void addDiscipline()}
              disabled={!newName.trim()}
              className="rounded border border-subtle px-2 py-1 text-12 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded border border-subtle px-2 py-1.5 text-12 text-secondary hover:text-primary"
          >
            <Plus className="size-3.5" />
            New discipline
          </button>
        )
      }
    >
      <ul className="space-y-1.5">
        {(items ?? []).map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-13 text-primary" title={item.name}>
              {item.name}
            </span>
            <span className="flex-shrink-0 text-11 text-tertiary">
              {renderFormattedDate(item.start_date)} → {renderFormattedDate(item.target_date)}
            </span>
            <select
              value={choice[item.id] ?? ""}
              onChange={(e) => setChoice((c) => ({ ...c, [item.id]: e.target.value }))}
              aria-label={`Discipline for ${item.name}`}
              className="w-44 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
            >
              <option value="">No discipline</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </GapModalShell>
  );
});
