/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "New project from template": pick an existing project as a blueprint, name the
 * new one, and (optionally) give a kickoff date so every planned date shifts onto
 * it. Copies states, work items, parent links and dependencies — not assignees.
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Copy, Loader2, X } from "lucide-react";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePortfolio } from "@/plane-web/hooks/store/use-portfolio";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Props = { isOpen: boolean; onClose: () => void };

// Derive a plausible 3–5 char identifier from the project name.
const suggestIdentifier = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 5) ||
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);

export const CloneProjectModal = observer(function CloneProjectModal(props: Props) {
  const { isOpen, onClose } = props;
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const portfolio = usePortfolio();
  const service = useMemo(() => new ArribadaService(), []);

  const projects = portfolio.allProjects.filter((p) => !p.archived);
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [kickoff, setKickoff] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const onName = (v: string) => {
    setName(v);
    if (!identifierTouched) setIdentifier(suggestIdentifier(v));
  };

  const submit = async () => {
    setError(null);
    if (!workspaceSlug || !sourceId || !name.trim() || !identifier.trim()) {
      setError("Pick a template, a name and an identifier.");
      return;
    }
    setBusy(true);
    try {
      const res = await service.cloneProject(workspaceSlug.toString(), sourceId, {
        name: name.trim(),
        identifier: identifier.trim().toUpperCase(),
        kickoff_date: kickoff || null,
      });
      onClose();
      router.push(`/${workspaceSlug}/projects/${res.project_id}/overview`);
    } catch (e) {
      const msg =
        (e as { identifier?: string[]; name?: string[]; error?: string })?.identifier?.[0] ??
        (e as { name?: string[] })?.name?.[0] ??
        (e as { error?: string })?.error ??
        "Clone failed. Check the identifier isn't already taken.";
      setError(String(msg));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={busy ? undefined : onClose}
      />
      <div className="shadow-2xl relative z-10 w-full max-w-md rounded-xl border border-subtle bg-layer-1 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-16 font-semibold text-primary">
            <Copy className="size-4 text-secondary" />
            New project from template
          </h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="clone-source"
              className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
            >
              Template project
            </label>
            <select id="clone-source" className={field} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Select a project to copy…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.item_count} items)
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-grow">
              <label
                htmlFor="clone-name"
                className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
              >
                New name
              </label>
              <input
                id="clone-name"
                className={field}
                value={name}
                onChange={(e) => onName(e.target.value)}
                placeholder="e.g. Sea Turtle Tag v2"
              />
            </div>
            <div className="w-24">
              <label
                htmlFor="clone-identifier"
                className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
              >
                ID
              </label>
              <input
                id="clone-identifier"
                className={cn(field, "uppercase")}
                value={identifier}
                onChange={(e) => {
                  setIdentifierTouched(true);
                  setIdentifier(e.target.value.toUpperCase());
                }}
                maxLength={12}
                placeholder="STT2"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="clone-kickoff"
              className="mb-1 block text-11 font-medium tracking-wide text-secondary uppercase"
            >
              Kickoff date <span className="text-placeholder normal-case">(optional — shifts all planned dates)</span>
            </label>
            <input
              id="clone-kickoff"
              type="date"
              className={field}
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
            />
          </div>

          {error && <p className="bg-red-500/10 text-red-600 rounded px-2.5 py-1.5 text-12">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "Cloning…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
});
