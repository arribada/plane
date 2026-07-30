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
import { BookOpen, Check, ExternalLink, FolderOpen, Github, Info, MessageSquare, Pencil, Plus, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectDocs } from "@/plane-web/types/arribada";

const AFFINE_BASE = "https://docs.arribada.org";
const EMPTY: TProjectDocs = {
  doc_id: null,
  workspace_id: null,
  title: null,
  google_drive_url: null,
  mattermost_channel_url: null,
  github_repo_urls: [],
};

// "owner/repo" from a github URL, else the raw string trimmed of protocol.
const repoLabel = (url: string): string => {
  const m = url.match(/github\.com\/([^/]+\/[^/?#]+)/i);
  return m ? m[1] : url.replace(/^https?:\/\//, "");
};

export const AffineWikiPanel = observer(function AffineWikiPanel() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const [docs, setDocs] = useState<TProjectDocs>(EMPTY);
  const [editing, setEditing] = useState<"affine" | "drive" | "chat" | "github" | null>(null);
  const [draftDoc, setDraftDoc] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDrive, setDraftDrive] = useState("");
  const [draftChat, setDraftChat] = useState("");
  const [draftRepo, setDraftRepo] = useState("");
  const [saving, setSaving] = useState(false);

  const repos = docs.github_repo_urls ?? [];
  const addRepo = async () => {
    const v = draftRepo.trim();
    if (!v) return;
    await persist({ github_repo_urls: [...repos, v] });
    setDraftRepo("");
  };
  const removeRepo = (url: string) => persist({ github_repo_urls: repos.filter((u) => u !== url) });

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      service
        .getAffineDoc(workspaceSlug.toString(), projectId.toString())
        .then((r) => {
          if (!cancelled) setDocs(r ?? EMPTY);
          return undefined;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  const persist = async (data: {
    doc_id?: string;
    title?: string;
    google_drive_url?: string;
    mattermost_channel_url?: string;
    github_repo_urls?: string[];
  }) => {
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

  const affineLink =
    docs.doc_id && docs.workspace_id ? `${AFFINE_BASE}/workspace/${docs.workspace_id}/${docs.doc_id}` : null;
  const driveLink = docs.google_drive_url;
  const chatLink = docs.mattermost_channel_url;

  const input = "rounded border border-subtle bg-layer-2 px-2 py-1 text-13 outline-none focus:border-accent-strong";
  const editBtn =
    "flex items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2";

  return (
    <div className="mb-3 rounded-lg border border-subtle bg-layer-1">
      {/* header note */}
      <div className="flex items-start gap-2 border-b border-subtle px-4 py-2.5">
        <Info className="mt-0.5 size-4 flex-shrink-0 text-accent-primary" />
        <div className="text-13">
          <span className="font-medium text-primary">Project documentation</span>
          <span className="text-secondary">
            {" "}
            — the project's wiki (AFFiNE), files (Google Drive), chat channel (Mattermost) and GitHub repos. Add any
            missing link below.
          </span>
        </div>
      </div>

      {/* AFFiNE row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <BookOpen className="size-4 flex-shrink-0 text-secondary" />
        <span className="w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">
          AFFiNE wiki
        </span>
        {affineLink ? (
          <a
            href={affineLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-13 font-medium text-accent-primary hover:underline"
          >
            {docs.title || "Open the project wiki"}
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span className="text-13 text-tertiary">Not linked yet — add the wiki page so everyone can find it.</span>
        )}
        <div className="flex-grow" />
        {editing === "affine" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Label (optional)"
              className={cn(input, "w-36")}
            />
            <input
              value={draftDoc}
              onChange={(e) => setDraftDoc(e.target.value)}
              placeholder="AFFiNE doc id or URL"
              className={cn(input, "w-56")}
            />
            <button
              type="button"
              onClick={() => persist({ doc_id: draftDoc.trim(), title: draftTitle.trim() })}
              disabled={saving}
              className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50"
            >
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
        <span className="w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">
          Google Drive
        </span>
        {driveLink ? (
          <a
            href={driveLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 truncate text-13 font-medium text-accent-primary hover:underline"
          >
            Open the Drive folder
            <ExternalLink className="size-3.5 flex-shrink-0" />
          </a>
        ) : (
          <span className="text-13 text-tertiary">Not linked yet — paste the shared Drive link for team access.</span>
        )}
        <div className="flex-grow" />
        {editing === "drive" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftDrive}
              onChange={(e) => setDraftDrive(e.target.value)}
              placeholder="https://drive.google.com/…"
              className={cn(input, "w-64")}
            />
            <button
              type="button"
              onClick={() => persist({ google_drive_url: draftDrive.trim() })}
              disabled={saving}
              className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50"
            >
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

      {/* Mattermost channel row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-4 py-2.5">
        <MessageSquare className="size-4 flex-shrink-0 text-secondary" />
        <span className="w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">
          Chat channel
        </span>
        {chatLink ? (
          <a
            href={chatLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 truncate text-13 font-medium text-accent-primary hover:underline"
          >
            Open the Mattermost channel
            <ExternalLink className="size-3.5 flex-shrink-0" />
          </a>
        ) : (
          <span className="text-13 text-tertiary">
            Not linked yet — paste the project's Mattermost channel link for notifications.
          </span>
        )}
        <div className="flex-grow" />
        {editing === "chat" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftChat}
              onChange={(e) => setDraftChat(e.target.value)}
              placeholder="https://chat.arribada.org/arribada/channels/…"
              className={cn(input, "w-64")}
            />
            <button
              type="button"
              onClick={() => persist({ mattermost_channel_url: draftChat.trim() })}
              disabled={saving}
              className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50"
            >
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
              setDraftChat(docs.mattermost_channel_url ?? "");
              setEditing("chat");
            }}
            className={editBtn}
          >
            {chatLink ? <Pencil className="size-3" /> : <Plus className="size-3" />}
            {chatLink ? "Change" : "Add link"}
          </button>
        )}
      </div>

      {/* GitHub repos row (a project can span several) */}
      <div className="flex flex-wrap items-start gap-3 border-t border-subtle px-4 py-2.5">
        <Github className="mt-0.5 size-4 flex-shrink-0 text-secondary" />
        <span className="mt-0.5 w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">
          GitHub repos
        </span>
        <div className="flex min-w-0 flex-grow flex-col gap-1.5">
          {repos.length === 0 && editing !== "github" && (
            <span className="text-13 text-tertiary">Not linked yet — add the project's GitHub repo(s).</span>
          )}
          {repos.map((url) => (
            <span key={url} className="flex items-center gap-1.5">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 truncate text-13 font-medium text-accent-primary hover:underline"
              >
                {repoLabel(url)}
                <ExternalLink className="size-3 flex-shrink-0" />
              </a>
              <button
                type="button"
                onClick={() => removeRepo(url)}
                disabled={saving}
                className="hover:text-red-600 text-tertiary"
                title="Remove"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {editing === "github" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={draftRepo}
                onChange={(e) => setDraftRepo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRepo()}
                placeholder="https://github.com/arribada/…"
                className={cn(input, "w-64")}
              />
              <button
                type="button"
                onClick={addRepo}
                disabled={saving}
                className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {saving ? "Saving…" : "Add"}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="text-secondary hover:text-primary">
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
        {editing !== "github" && (
          <button
            type="button"
            onClick={() => {
              setDraftRepo("");
              setEditing("github");
            }}
            className={editBtn}
          >
            <Plus className="size-3" />
            Add repo
          </button>
        )}
      </div>
    </div>
  );
});
