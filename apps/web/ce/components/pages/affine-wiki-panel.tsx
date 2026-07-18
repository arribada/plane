/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Info note at the top of a project's Pages section: this project's documentation
 * lives in AFFiNE (the self-hosted wiki) and in Google Drive, so the whole team
 * has access. Each link is either shown (opens in a new tab) or, when missing,
 * invites a member to add it. Private by design — links open in the user's own
 * AFFiNE/Google session; nothing is published.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BookOpen, Check, ExternalLink, FolderOpen, Info, Pencil, Plus, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectDocs } from "@/plane-web/types/arribada";

const AFFINE_BASE = "https://docs.arribada.org";
const EMPTY: TProjectDocs = { doc_id: null, workspace_id: null, title: null, google_drive_url: null };

export const AffineWikiPanel = observer(function AffineWikiPanel() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const [docs, setDocs] = useState<TProjectDocs>(EMPTY);
  const [editing, setEditing] = useState<"affine" | "drive" | null>(null);
  const [draftDoc, setDraftDoc] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDrive, setDraftDrive] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      service
        .getAffineDoc(workspaceSlug.toString(), projectId.toString())
        .then((r) => {
          if (!cancelled) setDocs(r ?? EMPTY);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  const persist = async (data: { doc_id?: string; title?: string; google_drive_url?: string }) => {
    if (!workspaceSlug || !projectId) return;
    setSaving(true);
    try {
      const r = await service.setAffineDoc(workspaceSlug.toString(), projectId.toString(), data);
      setDocs(r ?? EMPTY);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const affineLink = docs.doc_id && docs.workspace_id ? `${AFFINE_BASE}/workspace/${docs.workspace_id}/${docs.doc_id}` : null;
  const driveLink = docs.google_drive_url;

  const input = "rounded border border-subtle bg-layer-2 px-2 py-1 text-13 outline-none focus:border-accent-strong";
  const editBtn = "flex items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2";

  return (
    <div className="mb-3 rounded-lg border border-subtle bg-layer-1">
      {/* header note */}
      <div className="flex items-start gap-2 border-b border-subtle px-4 py-2.5">
        <Info className="mt-0.5 size-4 flex-shrink-0 text-accent-primary" />
        <div className="text-13">
          <span className="font-medium text-primary">Project documentation</span>
          <span className="text-secondary">
            {" "}
            — kept in AFFiNE (wiki) and Google Drive so the whole team has access. Add any missing link below.
          </span>
        </div>
      </div>

      {/* AFFiNE row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <BookOpen className="size-4 flex-shrink-0 text-secondary" />
        <span className="w-24 flex-shrink-0 text-12 font-medium uppercase tracking-wide text-secondary/80">AFFiNE wiki</span>
        {affineLink ? (
          <a href={affineLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-13 font-medium text-accent-primary hover:underline">
            {docs.title || "Open the project wiki"}
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span className="text-13 text-tertiary">Not linked yet — add the wiki page so everyone can find it.</span>
        )}
        <div className="flex-grow" />
        {editing === "affine" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Label (optional)" className={cn(input, "w-36")} />
            <input value={draftDoc} onChange={(e) => setDraftDoc(e.target.value)} placeholder="AFFiNE doc id or URL" className={cn(input, "w-56")} />
            <button type="button" onClick={() => persist({ doc_id: draftDoc.trim(), title: draftTitle.trim() })} disabled={saving} className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50">
              <Check className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-secondary hover:text-primary">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftDoc(docs.doc_id ?? "");
              setDraftTitle(docs.title ?? "");
              setEditing("affine");
            }}
            className={editBtn}
          >
            {affineLink ? <Pencil className="size-3" /> : <Plus className="size-3" />}
            {affineLink ? "Change" : "Add link"}
          </button>
        )}
      </div>

      {/* Google Drive row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-4 py-2.5">
        <FolderOpen className="size-4 flex-shrink-0 text-secondary" />
        <span className="w-24 flex-shrink-0 text-12 font-medium uppercase tracking-wide text-secondary/80">Google Drive</span>
        {driveLink ? (
          <a href={driveLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-13 font-medium text-accent-primary hover:underline">
            Open the Drive folder
            <ExternalLink className="size-3.5 flex-shrink-0" />
          </a>
        ) : (
          <span className="text-13 text-tertiary">Not linked yet — paste the shared Drive link for team access.</span>
        )}
        <div className="flex-grow" />
        {editing === "drive" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input value={draftDrive} onChange={(e) => setDraftDrive(e.target.value)} placeholder="https://drive.google.com/…" className={cn(input, "w-64")} />
            <button type="button" onClick={() => persist({ google_drive_url: draftDrive.trim() })} disabled={saving} className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50">
              <Check className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-secondary hover:text-primary">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftDrive(docs.google_drive_url ?? "");
              setEditing("drive");
            }}
            className={editBtn}
          >
            {driveLink ? <Pencil className="size-3" /> : <Plus className="size-3" />}
            {driveLink ? "Change" : "Add link"}
          </button>
        )}
      </div>
    </div>
  );
});
