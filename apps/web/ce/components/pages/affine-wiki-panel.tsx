/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A panel at the top of a project's Pages section that deep-links to the
 * project's page in the self-hosted AFFiNE wiki. Private by design: the link
 * opens AFFiNE in a new tab where the user's own AFFiNE session applies —
 * nothing is published. An admin/member can set which doc the project points to.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { BookOpen, ExternalLink, Pencil } from "lucide-react";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const AFFINE_BASE = "https://docs.arribada.org";

export const AffineWikiPanel = observer(function AffineWikiPanel() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const [docId, setDocId] = useState<string | null>(null);
  const [wsId, setWsId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (workspaceSlug && projectId) {
      service
        .getAffineDoc(workspaceSlug.toString(), projectId.toString())
        .then((r) => {
          if (cancelled) return;
          setDocId(r?.doc_id ?? null);
          setWsId(r?.workspace_id ?? null);
          setTitle(r?.title ?? null);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, service]);

  const save = async () => {
    if (!workspaceSlug || !projectId) return;
    setSaving(true);
    try {
      const r = await service.setAffineDoc(workspaceSlug.toString(), projectId.toString(), {
        doc_id: draft.trim(),
        title: draftTitle.trim(),
      });
      setDocId(r?.doc_id ?? null);
      setWsId(r?.workspace_id ?? null);
      setTitle(r?.title ?? null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const link = docId && wsId ? `${AFFINE_BASE}/workspace/${wsId}/${docId}` : null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-subtle bg-layer-1 px-4 py-2.5">
      <BookOpen className="size-4 flex-shrink-0 text-accent" />
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-13 font-medium text-accent hover:underline"
        >
          {title || "Open the project wiki in AFFiNE"}
          <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <span className="text-13 text-secondary">No AFFiNE wiki page linked to this project yet.</span>
      )}

      <div className="flex-grow" />

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Label (optional)"
            className="w-36 rounded border border-subtle bg-layer-2 px-2 py-1 text-13"
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="AFFiNE doc id or URL"
            className="w-56 rounded border border-subtle bg-layer-2 px-2 py-1 text-13"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-accent px-2 py-1 text-13 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-13 text-secondary hover:text-primary">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(docId ?? "");
            setDraftTitle(title ?? "");
            setEditing(true);
          }}
          className="flex items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2"
        >
          <Pencil className="size-3" />
          {link ? "Change" : "Link a page"}
        </button>
      )}
    </div>
  );
});
