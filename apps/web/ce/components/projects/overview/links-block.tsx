/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where the project's knowledge lives: its Plane pages plus the four external
 * homes (wiki, Drive, chat, GitHub). Missing links are shown as "Not set"
 * rather than hidden, because an invisible gap never gets filled.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, Check, ExternalLink, FileText, FolderOpen, Github, MessageSquare, Pencil, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectDocs, TProjectOverview } from "@/plane-web/types/arribada";

// Same deep-link grammar the Pages panel uses: a doc id is only addressable
// together with the wiki workspace it belongs to.
const WIKI_BASE = "https://docs.arribada.org";

type Props = {
  anchorId: string;
  overview: TProjectOverview;
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

// The form only exists once the current links are known: the endpoint reads a
// present-but-empty key as "clear this link", so saving fields that never loaded
// would delete links nobody touched.
type TFetchState = "loading" | "loaded" | "error";

const EMPTY_DOCS: TProjectDocs = {
  doc_id: null,
  workspace_id: null,
  title: null,
  google_drive_url: null,
  mattermost_channel_url: null,
  github_repo_urls: [],
};

const CHIP = "inline-flex max-w-full items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 text-12";
const INPUT =
  "w-full rounded border border-subtle bg-layer-2 px-2 py-1 text-13 text-primary outline-none focus:border-accent-strong";

// "owner/repo" from a github URL, else the raw string trimmed of protocol.
const repoLabel = (url: string): string => {
  const m = url.match(/github\.com\/([^/]+\/[^/?#]+)/i);
  return m ? m[1] : url.replace(/^https?:\/\//, "");
};

const LinkChip = ({ icon, label, href }: { icon: ReactNode; label: string; href: string | null }) =>
  href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(CHIP, "text-accent-primary hover:bg-layer-2")}
      title={href}
    >
      {icon}
      <span className="truncate">{label}</span>
      <ExternalLink className="size-3 flex-shrink-0" />
    </a>
  ) : (
    <span className={cn(CHIP, "text-tertiary")}>
      {icon}
      {label}: Not set
    </span>
  );

export const OverviewLinksBlock = observer(function OverviewLinksBlock(props: Props) {
  const { anchorId, overview, editorOpen, onEditorOpenChange, onSaved } = props;
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);

  const [docs, setDocs] = useState<TProjectDocs | null>(null);
  const [baseline, setBaseline] = useState<TProjectDocs | null>(null);
  const [fetchState, setFetchState] = useState<TFetchState>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [draftDoc, setDraftDoc] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDrive, setDraftDrive] = useState("");
  const [draftChat, setDraftChat] = useState("");
  const [draftRepos, setDraftRepos] = useState("");
  const [saving, setSaving] = useState(false);

  // The overview payload carries the resolved URLs but not the doc id, so the
  // editable shape is only fetched when someone actually opens the editor.
  useEffect(() => {
    let cancelled = false;
    if (editorOpen && workspaceSlug && projectId) {
      setFetchState("loading");
      setBaseline(null);
      service
        .getAffineDoc(workspaceSlug.toString(), projectId.toString())
        .then((r) => {
          if (cancelled) return;
          const current = r ?? EMPTY_DOCS;
          if (r) setDocs(r);
          setBaseline(current);
          setDraftDoc(current.doc_id ?? "");
          setDraftTitle(current.title ?? "");
          setDraftDrive(current.google_drive_url ?? "");
          setDraftChat(current.mattermost_channel_url ?? "");
          setDraftRepos((current.github_repo_urls ?? []).join("\n"));
          setFetchState("loaded");
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setFetchState("error");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [editorOpen, workspaceSlug, projectId, service, retryToken]);

  const save = async () => {
    if (!workspaceSlug || !projectId || !baseline) return;
    const repos = draftRepos
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    // Only the keys the user actually changed travel: an untouched key left out
    // of the payload is the only way to say "leave this link alone".
    const payload: Parameters<ArribadaService["setAffineDoc"]>[2] = {};
    if (draftDoc.trim() !== (baseline.doc_id ?? "")) payload.doc_id = draftDoc.trim();
    if (draftTitle.trim() !== (baseline.title ?? "")) payload.title = draftTitle.trim();
    if (draftDrive.trim() !== (baseline.google_drive_url ?? "")) payload.google_drive_url = draftDrive.trim();
    if (draftChat.trim() !== (baseline.mattermost_channel_url ?? "")) payload.mattermost_channel_url = draftChat.trim();
    if (repos.join("\n") !== (baseline.github_repo_urls ?? []).join("\n")) payload.github_repo_urls = repos;

    if (Object.keys(payload).length === 0) {
      onEditorOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      const r = await service.setAffineDoc(workspaceSlug.toString(), projectId.toString(), payload);
      setDocs(r);
      setBaseline(r);
      onEditorOpenChange(false);
      onSaved?.();
    } catch {
      // The editor stays open so the typed values are not lost with the error.
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save these links",
        message: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Once saved, the freshly returned docs win over the (now stale) overview payload.
  const wikiUrl = docs
    ? docs.doc_id && docs.workspace_id
      ? `${WIKI_BASE}/workspace/${docs.workspace_id}/${docs.doc_id}`
      : null
    : overview.links.wiki_url;
  const driveUrl = docs ? docs.google_drive_url : overview.links.drive_url;
  const chatUrl = docs ? docs.mattermost_channel_url : overview.links.chat_url;
  const repos = (docs ? docs.github_repo_urls : overview.links.github_repo_urls) ?? [];

  const base = `/${workspaceSlug}/projects/${projectId}`;

  return (
    <div id={anchorId} className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <h2 className="text-13 font-semibold text-primary">Documentation & links</h2>
        <button
          type="button"
          onClick={() => onEditorOpenChange(!editorOpen)}
          className="flex items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2"
        >
          {editorOpen ? <X className="size-3" /> : <Pencil className="size-3" />}
          {editorOpen ? "Cancel" : "Edit links"}
        </button>
      </div>

      {overview.project.page_view && (
        <div className="border-b border-subtle px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-12 font-medium tracking-wide text-secondary uppercase">
              Pages · {overview.pages.count}
            </span>
            <Link href={`${base}/pages`} className="text-12 text-accent-primary hover:underline">
              All pages
            </Link>
          </div>
          {overview.pages.recent.length === 0 ? (
            <p className="text-13 text-tertiary">No pages yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {overview.pages.recent.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`${base}/pages/${p.id}`}
                    className="flex items-center gap-1.5 text-13 text-primary hover:text-accent-primary"
                  >
                    <FileText className="size-3.5 flex-shrink-0 text-tertiary" />
                    <span className="truncate">{p.name || "Untitled"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <LinkChip icon={<BookOpen className="size-3.5 flex-shrink-0" />} label={docs?.title || "Wiki"} href={wikiUrl} />
        <LinkChip icon={<FolderOpen className="size-3.5 flex-shrink-0" />} label="Drive" href={driveUrl} />
        <LinkChip icon={<MessageSquare className="size-3.5 flex-shrink-0" />} label="Chat" href={chatUrl} />
        {repos.length === 0 ? (
          <LinkChip icon={<Github className="size-3.5 flex-shrink-0" />} label="GitHub" href={null} />
        ) : (
          repos.map((url) => (
            <LinkChip
              key={url}
              icon={<Github className="size-3.5 flex-shrink-0" />}
              label={repoLabel(url)}
              href={url}
            />
          ))
        )}
      </div>

      {editorOpen && fetchState === "loading" && (
        <Loader className="grid grid-cols-1 gap-3 border-t border-subtle px-3 py-3 sm:grid-cols-2">
          <Loader.Item height="46px" className="bg-layer-2" />
          <Loader.Item height="46px" className="bg-layer-2" />
          <Loader.Item height="46px" className="bg-layer-2" />
          <Loader.Item height="46px" className="bg-layer-2" />
        </Loader>
      )}

      {editorOpen && fetchState === "error" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-3 py-3">
          <p className="text-13 text-secondary">
            Couldn&apos;t read this project&apos;s current links — editing them now could wipe what is already set.
          </p>
          <button
            type="button"
            onClick={() => setRetryToken((n) => n + 1)}
            className="rounded border border-subtle px-2.5 py-1 text-12 text-secondary hover:bg-layer-2"
          >
            Retry
          </button>
        </div>
      )}

      {editorOpen && fetchState === "loaded" && (
        <div className="grid grid-cols-1 gap-3 border-t border-subtle px-3 py-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-11 font-medium tracking-wide text-secondary uppercase">
            Wiki doc id or URL
            <input value={draftDoc} onChange={(e) => setDraftDoc(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-11 font-medium tracking-wide text-secondary uppercase">
            Wiki label
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-11 font-medium tracking-wide text-secondary uppercase">
            Google Drive URL
            <input
              value={draftDrive}
              onChange={(e) => setDraftDrive(e.target.value)}
              placeholder="https://drive.google.com/…"
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1 text-11 font-medium tracking-wide text-secondary uppercase">
            Chat channel URL
            <input
              value={draftChat}
              onChange={(e) => setDraftChat(e.target.value)}
              placeholder="https://chat.arribada.org/…"
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1 text-11 font-medium tracking-wide text-secondary uppercase sm:col-span-2">
            GitHub repos (one URL per line)
            <textarea
              value={draftRepos}
              onChange={(e) => setDraftRepos(e.target.value)}
              rows={2}
              placeholder="https://github.com/arribada/…"
              className={cn(INPUT, "resize-none")}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-3.5" />
              {saving ? "Saving…" : "Save links"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
