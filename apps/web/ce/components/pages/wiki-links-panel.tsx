/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Info note at the top of a project's Pages section: this project's documentation
 * lives in the team wiki (docs.arribada.org) and in Google Drive, so the whole
 * team has access. Each link is either shown (opens in a new tab) or, when
 * missing, invites a member to add it. Private by design — links open in the
 * user's own wiki/Google session; nothing is published.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ExternalLink,
  FolderOpen,
  Github,
  Info,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useUserPermissions } from "@/hooks/store/user";
import { githubSyncToast } from "@/plane-web/components/github-triage/sync-toast";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectDocs } from "@/plane-web/types/arribada";

const WIKI_BASE = "https://docs.arribada.org";
const EMPTY: TProjectDocs = {
  doc_id: null,
  workspace_id: null,
  title: null,
  google_drive_url: null,
  chat_url: null,
  github_repo_urls: [],
};

// "owner/repo" from a github URL, else the raw string trimmed of protocol.
const repoLabel = (url: string): string => {
  const m = url.match(/github\.com\/([^/]+\/[^/?#]+)/i);
  return m ? m[1] : url.replace(/^https?:\/\//, "");
};

export const WikiLinksPanel = observer(function WikiLinksPanel() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { allowPermissions } = useUserPermissions();
  const [docs, setDocs] = useState<TProjectDocs>(EMPTY);
  const [editing, setEditing] = useState<"wiki" | "drive" | "chat" | "github" | null>(null);
  const [draftDoc, setDraftDoc] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDrive, setDraftDrive] = useState("");
  const [draftChat, setDraftChat] = useState("");
  const [draftRepo, setDraftRepo] = useState("");
  const [saving, setSaving] = useState(false);
  // Whether the panel is showing what the server holds. Until the fetch answers,
  // "no link" and "we don't know yet" look identical on screen — and they are not
  // the same thing at all: acting on the second one overwrites a link that exists.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // The PUT behind every button here is ADMIN/MEMBER **on this project**, not on
  // the workspace — `ProjectWikiDocEndpoint.put` moved to `level="PROJECT"` when
  // the permission class was fixed. This gate did not move with it, so a
  // workspace member who is a guest on the project (or not on it at all, and
  // reading it as a workspace admin who never joined) saw every pencil, typed a
  // URL, and got a 403 whose message told them they were something they already
  // were: "only workspace members and admins can edit". Same level, same roles,
  // same order as the decorator — that is the whole rule.
  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug?.toString(),
    projectId?.toString()
  );
  const editable = canEdit && loaded && !loadFailed;

  const repos = docs.github_repo_urls ?? [];

  const [syncing, setSyncing] = useState(false);
  const syncGithubNow = async () => {
    if (!workspaceSlug || !projectId) return;
    setSyncing(true);
    try {
      const r = await service.githubSyncNow(workspaceSlug.toString(), projectId.toString());
      if (r.skipped) {
        // A configuration answer, not a failure: say which one, because "no token"
        // and "no repos mapped" need different people to do different things.
        setToast({ type: TOAST_TYPE.INFO, title: "Nothing was pulled", message: r.skipped });
      } else {
        setToast(githubSyncToast(r));
      }
    } catch (e) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't sync",
        message: (e as { error?: string })?.error ?? "GitHub did not answer.",
      });
    } finally {
      setSyncing(false);
    }
  };
  const addRepo = async () => {
    const v = draftRepo.trim();
    if (!v) return;
    if (await persist({ github_repo_urls: [...repos, v] })) setDraftRepo("");
  };
  const removeRepo = (url: string) => {
    void persist({ github_repo_urls: repos.filter((u) => u !== url) });
  };

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      setLoaded(false);
      setLoadFailed(false);
      service
        .getWikiDoc(workspaceSlug.toString(), projectId.toString())
        .then((r) => {
          if (!cancelled) {
            setDocs(r ?? EMPTY);
            setLoaded(true);
          }
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  const persist = async (data: {
    doc_id?: string;
    title?: string;
    google_drive_url?: string;
    chat_url?: string;
    github_repo_urls?: string[];
  }): Promise<boolean> => {
    if (!workspaceSlug || !projectId) return false;
    setSaving(true);
    try {
      const r = await service.setWikiDoc(workspaceSlug.toString(), projectId.toString(), data);
      setDocs(r ?? EMPTY);
      setEditing(null);
      return true;
    } catch (error) {
      // Without this the rejection was unhandled: the spinner stopped, the editor
      // stayed open holding the typed URL, and nothing said whether it had saved.
      const status = (error as { status?: number })?.status;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: status === 403 ? "You can't change these links" : "Couldn't save the link",
        message:
          status === 403
            ? // Names the level the server actually decides on. Saying "workspace"
              // here told a workspace member they were not one, which reads as a
              // broken product rather than as a permission they can go and ask for.
              "These links belong to the project. You need to be a member or an admin of this project to change them."
            : "Nothing was saved. Check the address and try again.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Colanode addresses a doc as /<workspace>/<doc> — any extra segment 404s.
  const wikiLink = docs.doc_id && docs.workspace_id ? `${WIKI_BASE}/${docs.workspace_id}/${docs.doc_id}` : null;
  const driveLink = docs.google_drive_url;
  const chatLink = docs.chat_url;

  const input = "rounded border border-subtle bg-layer-2 px-2 py-1 text-13 outline-none focus:border-accent-strong";
  const editBtn =
    "flex items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2";

  // What a row says when it holds no link. Only "Not linked yet" while the panel
  // actually knows that — before the fetch answers, or after it failed, saying so
  // would invite someone to paste over a link that is already there.
  const emptyRow = (hint: string) => (
    <span className="text-13 text-tertiary">{loadFailed ? "Unknown" : loaded ? hint : "Loading…"}</span>
  );

  return (
    <div className="mb-3 rounded-lg border border-subtle bg-layer-1">
      {/* header note */}
      <div className="flex items-start gap-2 border-b border-subtle px-4 py-2.5">
        {loadFailed ? (
          <AlertTriangle className="mt-0.5 size-4 flex-shrink-0 text-warning-primary" />
        ) : (
          <Info className="mt-0.5 size-4 flex-shrink-0 text-accent-primary" />
        )}
        <div className="text-13">
          <span className="font-medium text-primary">Project documentation</span>
          {loadFailed ? (
            <span className="text-secondary">
              {" "}
              — couldn't load this project's links, so what's below may be incomplete. Reload the page before editing.
            </span>
          ) : (
            <span className="text-secondary">
              {" "}
              — the project's wiki, files (Google Drive), chat channel and GitHub repos. Add any missing link below.
            </span>
          )}
        </div>
      </div>

      {/* Wiki row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <BookOpen className="size-4 flex-shrink-0 text-secondary" />
        <span className="w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">Wiki</span>
        {wikiLink ? (
          <a
            href={wikiLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-13 font-medium text-accent-primary hover:underline"
          >
            {docs.title || "Open the project wiki"}
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          emptyRow("Not linked yet — add the wiki page so everyone can find it.")
        )}
        <div className="flex-grow" />
        {editing === "wiki" ? (
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
              placeholder="Wiki doc id or URL"
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
          editable && (
            <button
              type="button"
              onClick={() => {
                setDraftDoc(docs.doc_id ?? "");
                setDraftTitle(docs.title ?? "");
                setEditing("wiki");
              }}
              className={editBtn}
            >
              {wikiLink ? <Pencil className="size-3" /> : <Plus className="size-3" />}
              {wikiLink ? "Change" : "Add link"}
            </button>
          )
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
          emptyRow("Not linked yet — paste the shared Drive link for team access.")
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
          editable && (
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
          )
        )}
      </div>

      {/* Chat channel row */}
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
            Open the chat channel
            <ExternalLink className="size-3.5 flex-shrink-0" />
          </a>
        ) : (
          emptyRow("Not linked yet — paste the project's chat channel link for notifications.")
        )}
        <div className="flex-grow" />
        {editing === "chat" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftChat}
              onChange={(e) => setDraftChat(e.target.value)}
              placeholder="https://chat.arribada.org/…"
              className={cn(input, "w-64")}
            />
            <button
              type="button"
              onClick={() => persist({ chat_url: draftChat.trim() })}
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
          editable && (
            <button
              type="button"
              onClick={() => {
                setDraftChat(docs.chat_url ?? "");
                setEditing("chat");
              }}
              className={editBtn}
            >
              {chatLink ? <Pencil className="size-3" /> : <Plus className="size-3" />}
              {chatLink ? "Change" : "Add link"}
            </button>
          )
        )}
      </div>

      {/* GitHub repos row (a project can span several) */}
      <div className="flex flex-wrap items-start gap-3 border-t border-subtle px-4 py-2.5">
        <Github className="mt-0.5 size-4 flex-shrink-0 text-secondary" />
        <span className="mt-0.5 w-24 flex-shrink-0 text-12 font-medium tracking-wide text-secondary/80 uppercase">
          GitHub repos
        </span>
        <div className="flex min-w-0 flex-grow flex-col gap-1.5">
          {repos.length === 0 && editing !== "github" && emptyRow("Not linked yet — add the project's GitHub repo(s).")}
          {repos.length > 0 && (
            // Beside the repos it acts on, not in a menu three clicks away. The
            // sync has always run nightly; what was missing was being able to ask
            // for it at the moment you care — right after linking a repo, or two
            // minutes after opening an issue you want on the board.
            <button
              type="button"
              onClick={() => void syncGithubNow()}
              disabled={syncing}
              title="Pull open issues from these repos into the GitHub inbox now, instead of waiting for tonight."
              className={cn(
                "flex items-center gap-1.5 self-start rounded border border-subtle px-2 py-1 text-11 text-secondary",
                syncing ? "opacity-50" : "hover:bg-layer-2 hover:text-primary"
              )}
            >
              <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync issues now"}
            </button>
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
                disabled={saving || !editable}
                className="text-tertiary hover:text-danger-primary"
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
        {editing !== "github" && editable && (
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
