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
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

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

  useEffect(() => {
    if (!isOpen || !workspaceSlug || !projectId) return;
    let live = true;
    setItems(null);
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

  if (!isOpen) return null;

  const filled = Object.values(choice).filter(Boolean).length;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="shadow-lg relative z-10 flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-subtle bg-layer-1">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          <h2 className="flex-1 text-14 font-medium text-primary">Set the missing disciplines</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-tertiary hover:text-primary">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items === null ? (
            <p className="text-13 text-tertiary">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-13 text-tertiary">Every dated item already has a discipline.</p>
          ) : (
            <>
              <p className="mb-3 text-12 text-tertiary">
                A rate belongs to a trade, so an item with no discipline has no cost however many days it spans. Rows
                already showing a value took it from their assignee — nothing is saved until you press the button.
              </p>
              <ul className="space-y-1.5">
                {items.map((item) => (
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
                      <option value="">Leave unset</option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {items && items.length > 0 && (
          <footer className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3">
            <span className="mr-auto text-11 text-tertiary">
              {filled} of {items.length} set
            </span>
            <button type="button" onClick={onClose} className="rounded border border-subtle px-3 py-1.5 text-12">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || filled === 0}
              className={cn(
                "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
                saving || filled === 0 ? "opacity-50" : "hover:opacity-90"
              )}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save {filled}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
});
