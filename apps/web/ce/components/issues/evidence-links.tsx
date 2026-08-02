/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where the proof of this work item lives.
 *
 * The only external links this fork had were on the PROJECT — one wiki doc, one
 * Drive folder, some repos. So "show me the test evidence for deliverable 3.2"
 * had no answer finer than "here is the project's entire Drive folder", which is
 * not an answer a reviewer accepts.
 *
 * These are POINTERS, never copies. The wiki stays the system of record for the
 * durable material — hardware catalogue, unit serials, orders — and a row here
 * says which page, file or repository proves THIS task. Two systems of record for
 * the same devices is exactly the drift an ESA-style review catches.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { BookText, FileText, Github, Link2, Plus, Trash2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

export type TArtifactKind = "wiki" | "drive" | "github" | "other";

export type TIssueArtifact = {
  id: string;
  kind: TArtifactKind;
  url: string;
  label: string;
  created_by_name: string | null;
};

/** Icon per destination: a reader should know whether they are about to open a
 *  wiki page or a repository before they click. */
const ICONS: Record<TArtifactKind, typeof Link2> = {
  wiki: BookText,
  drive: FileText,
  github: Github,
  other: Link2,
};

const KIND_LABEL: Record<TArtifactKind, string> = {
  wiki: "Wiki",
  drive: "Drive",
  github: "GitHub",
  other: "Link",
};

/** A Drive URL is unreadable, so a row falls back to its host rather than to 80
 *  characters of query string. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

export const IssueEvidenceLinks = observer(function IssueEvidenceLinks({
  workspaceSlug,
  projectId,
  issueId,
  disabled,
}: Props) {
  const [rows, setRows] = useState<TIssueArtifact[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    service
      .getIssueArtifacts(workspaceSlug, projectId, issueId)
      .then((found) => {
        if (!cancelled) setRows(found);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, issueId]);

  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await service.addIssueArtifact(workspaceSlug, projectId, issueId, trimmed, label.trim());
      setRows((current) => [...(current ?? []), created]);
      setUrl("");
      setLabel("");
      setAdding(false);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't add that link",
        // The server refuses anything that is not http(s) and says why: a link
        // nobody can follow is worse than none, because it looks like the evidence
        // exists.
        message: (error as { error?: string })?.error || "Nothing was added.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove the link to ${name}? The document itself is untouched.`)) return;
    try {
      await service.removeIssueArtifact(workspaceSlug, projectId, issueId, id);
      setRows((current) => (current ?? []).filter((r) => r.id !== id));
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't remove that link", message: "It is still there." });
    }
  };

  // Nothing to show and nothing to add: stay out of the way entirely rather than
  // add an empty box to a panel that is already long.
  if (rows !== null && rows.length === 0 && disabled) return null;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-11 font-medium tracking-wide text-tertiary uppercase">Evidence</p>
        {!disabled && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-11 text-secondary hover:text-primary"
          >
            <Plus className="size-3" />
            Add a link
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-subtle bg-layer-2 p-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-10 text-tertiary uppercase">Link</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.arribada.org/… or a Drive file, or a GitHub URL"
              className="rounded border border-subtle bg-surface-1 px-2 py-1 text-12 text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-10 text-tertiary uppercase">Call it</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Saltwater switch test report"
              className="w-52 rounded border border-subtle bg-surface-1 px-2 py-1 text-12 text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </label>
          <button
            type="button"
            onClick={() => void add()}
            disabled={saving || !url.trim()}
            className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setUrl("");
              setLabel("");
            }}
            className="p-1 text-secondary hover:text-primary"
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {rows === null ? (
        <div className="h-8 animate-pulse rounded bg-layer-1" />
      ) : rows.length === 0 ? (
        <p className="text-11 text-tertiary">
          Nothing linked yet. A test report, a BOM, a board revision — whatever proves this is done.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const Icon = ICONS[row.kind] ?? Link2;
            return (
              <li key={row.id} className="group flex items-center gap-2">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-12 text-primary hover:text-accent-primary hover:underline"
                >
                  <Icon className="size-3.5 flex-shrink-0 text-tertiary" />
                  <span className="truncate">{row.label || hostOf(row.url)}</span>
                  <span className="flex-shrink-0 text-10 text-tertiary">{KIND_LABEL[row.kind]}</span>
                </a>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => void remove(row.id, row.label || hostOf(row.url))}
                    aria-label={`Remove the link to ${row.label || hostOf(row.url)}`}
                    className={cn(
                      // p-2 -m-2 keeps the icon where it is and takes the target to ~44px.
                      "-m-2 flex-shrink-0 p-2 text-tertiary opacity-0 transition-opacity",
                      "group-hover:opacity-100 hover:text-danger-primary focus-visible:opacity-100"
                    )}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
