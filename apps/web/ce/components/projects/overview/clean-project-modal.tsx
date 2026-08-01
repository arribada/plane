/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Emptying a project, category by category. Setting one up is a five-minute job
 * now, which makes getting it wrong cheap — but only if starting over is cheap too.
 *
 * Nothing is destroyed on a click: the identifier has to be typed, and the button
 * says what is about to go rather than "Confirm".
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { useModalShell } from "@/plane-web/components/common/use-modal-shell";

type Category = "work_items" | "cycles" | "modules" | "roles" | "team" | "schedule" | "links";

const CATEGORIES: { key: Category; label: string; hint: string }[] = [
  { key: "work_items", label: "Work items", hint: "Every item, with its dependencies and owners. Recoverable." },
  { key: "cycles", label: "Sprints", hint: "The cycles, not the items in them." },
  { key: "modules", label: "Modules", hint: "The per-component modules." },
  { key: "roles", label: "Disciplines on items", hint: "What each item needs — not the roster." },
  { key: "team", label: "Team roster", hint: "Who is on the project and what they cover." },
  { key: "schedule", label: "Project window", hint: "The planned start and target dates." },
  { key: "links", label: "Wiki and links", hint: "Wiki doc, Drive, chat and repositories." },
];

type Props = {
  projectId: string | null;
  identifier: string;
  onClose: () => void;
  onCleaned?: () => void;
};

export const CleanProjectModal = observer(function CleanProjectModal({
  projectId,
  identifier,
  onClose,
  onCleaned,
}: Props) {
  const { workspaceSlug } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number> | null>(null);

  // Escape, a focus trap, focus restored on close and a page that stops
  // scrolling underneath — the four things this hand-rolled overlay lacked.
  // Placed above the early return so the hook runs on every render.
  const { panelProps } = useModalShell({ open: !!projectId, onClose });

  if (!projectId) return null;

  const slug = workspaceSlug?.toString() ?? "";
  const allOn = selected.size === CATEGORIES.length;
  const matches = confirm.trim().toUpperCase() === identifier.toUpperCase();

  const toggle = (key: Category) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = async () => {
    if (busy || selected.size === 0 || !matches) return;
    setBusy(true);
    setError(null);
    try {
      const payload = Object.fromEntries([...selected].map((key) => [key, true]));
      const result = await service.cleanProject(slug, projectId, { confirm: confirm.trim(), ...payload });
      setDone(result.removed);
      onCleaned?.();
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not clean the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={busy ? undefined : onClose}
      />
      <div
        className="shadow-2xl relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-subtle bg-layer-1"
        {...panelProps}
      >
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-16 font-semibold text-primary">Clean this project</h3>
            <p className="text-11 text-tertiary">{identifier}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {done ? (
            <div className="space-y-2">
              <p className="text-13 text-primary">Done.</p>
              <ul className="text-13 text-secondary">
                {Object.entries(done).map(([key, count]) => (
                  <li key={key}>
                    {CATEGORIES.find((c) => c.key === key)?.label ?? key}: {count} removed
                  </li>
                ))}
              </ul>
              <p className="text-12 text-tertiary">
                Work items, sprints and modules are hidden rather than destroyed — recoverable from the database if this
                was a mistake.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-13 text-secondary">Pick what to remove.</p>
                <button
                  type="button"
                  onClick={() => setSelected(allOn ? new Set() : new Set(CATEGORIES.map((c) => c.key)))}
                  className="text-11 text-secondary hover:text-primary"
                >
                  {allOn ? "Clear all" : "Select everything"}
                </button>
              </div>

              <ul className="overflow-hidden rounded-lg border border-subtle">
                {CATEGORIES.map((category) => (
                  <li
                    key={category.key}
                    className="flex items-start gap-2 border-b border-subtle px-3 py-2 last:border-b-0"
                  >
                    <input
                      id={`clean-${category.key}`}
                      type="checkbox"
                      checked={selected.has(category.key)}
                      onChange={() => toggle(category.key)}
                      className="mt-0.5 size-3.5 flex-shrink-0 text-accent-primary"
                    />
                    <label htmlFor={`clean-${category.key}`} className="min-w-0 flex-1">
                      <span className="block text-13 text-primary">{category.label}</span>
                      <span className="block text-11 text-tertiary">{category.hint}</span>
                    </label>
                  </li>
                ))}
              </ul>

              <div>
                <label
                  className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
                  htmlFor="clean-confirm"
                >
                  Type {identifier} to confirm
                </label>
                <input
                  id="clean-confirm"
                  className="w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={identifier}
                  autoComplete="off"
                />
              </div>

              {error && <p className="rounded bg-danger-subtle px-2.5 py-1.5 text-12 text-danger-primary">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-subtle px-5 py-3">
          <span className="flex items-center gap-1.5 text-11 text-tertiary">
            <AlertTriangle className="size-3.5 flex-shrink-0 text-warning-primary" />
            The roster, disciplines, window and links are removed outright.
          </span>
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90"
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={busy || selected.size === 0 || !matches}
              className={cn(
                "flex items-center gap-1.5 rounded bg-danger-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90",
                (busy || selected.size === 0 || !matches) && "opacity-50"
              )}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Remove {selected.size} categor{selected.size === 1 ? "y" : "ies"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
