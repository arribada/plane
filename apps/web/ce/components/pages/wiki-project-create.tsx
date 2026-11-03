/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Create the wiki project": asks the wiki to create this project's pages from
 * its project template (Overview, Requirements, Tests and validation,
 * Decisions and ADR…) under the mission picked here, with this project's
 * identifier as its code, and links them. Shown only on a project that has no
 * wiki page yet — a second set of pages would split its documentation in two.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { OFFLINE_MESSAGE, type TApiFailure } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TWikiProjectParent } from "@/plane-web/types/arribada";

type Props = {
  workspaceSlug: string;
  projectId: string;
  onCreated: () => void;
  onCancel: () => void;
};

// What the person is told when the wiki says no. The wiki answers with its own
// sentence; the codes below are the ones worth a sentence of ours instead.
export const wikiCreateFailureMessage = (failure: TApiFailure | undefined): string => {
  if (!failure) return "The wiki did not answer.";
  if (failure.offline) return OFFLINE_MESSAGE;
  switch (failure.error) {
    case "already_linked":
      return "This project already has its wiki page.";
    case "identifier_not_letters":
      return "The wiki needs a project identifier of 2 to 10 capital letters. Change the identifier first.";
    case "code_taken":
      return "The wiki already has a project with this identifier.";
    case "not_configured":
      return "The link with the wiki is not set up on this server.";
    case "wiki_unreachable":
      return "The wiki did not answer. Nothing was created.";
    default:
      return typeof failure.message === "string" && failure.message
        ? failure.message
        : "The wiki refused the request. Nothing was created.";
  }
};

export function WikiProjectCreate({ workspaceSlug, projectId, onCreated, onCancel }: Props) {
  const service = useMemo(() => new ArribadaService(), []);
  const [parents, setParents] = useState<TWikiProjectParent[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    service
      .getWikiProjectParents(workspaceSlug, projectId)
      .then((list) => {
        if (cancelled) return undefined;
        setParents(list);
        setParentId(list[0]?.id ?? "");
        return undefined;
      })
      .catch((error: TApiFailure) => {
        if (!cancelled) setFailed(wikiCreateFailureMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [service, workspaceSlug, projectId]);

  const create = async () => {
    if (!parentId) return;
    setCreating(true);
    try {
      await service.createWikiProject(workspaceSlug, projectId, parentId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Wiki project created",
        message: "Its pages are on the wiki, linked from here.",
      });
      onCreated();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't create the wiki project",
        message: wikiCreateFailureMessage(error as TApiFailure),
      });
    } finally {
      setCreating(false);
    }
  };

  const input = "rounded border border-subtle bg-layer-2 px-2 py-1 text-13 outline-none focus:border-accent-strong";

  if (failed) {
    return (
      <div className="flex items-center gap-2 text-13 text-secondary">
        {failed}
        <button type="button" onClick={onCancel} className="text-secondary hover:text-primary" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {parents === null ? (
        <span className="text-13 text-tertiary">Loading the missions…</span>
      ) : (
        <select
          aria-label="Wiki mission or product line"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className={cn(input, "max-w-72")}
        >
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.depth > 1 ? "   " : ""}
              {parent.path}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => void create()}
        disabled={creating || !parentId}
        className="flex items-center gap-1 rounded bg-accent-primary px-2 py-1 text-13 text-white disabled:opacity-50"
      >
        <Check className="size-3.5" />
        {creating ? "Creating…" : "Create the pages"}
      </button>
      <button type="button" onClick={onCancel} className="text-secondary hover:text-primary" aria-label="Cancel">
        <X className="size-4" />
      </button>
    </div>
  );
}
