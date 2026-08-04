/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Where GitHub issues nobody could route get decided.
 *
 * The router files what it can — a repo exactly one project claims — so what
 * reaches this page is the residue: repos two projects claim, and repos nobody
 * has linked. Mixing those with the routable ones is what turned the inbox into
 * "39 items" that nobody could act on, because most of them needed no decision
 * at all and the rest were invisible among them.
 *
 * Every row arrives filled in as far as the evidence goes. What it cannot know
 * — which of two projects owns a shared repo — is exactly what is left to
 * answer, and it is one dropdown.
 *
 * The second question is whether an issue deserves a work item of its own.
 * Often several of them are one task, so a row can instead join an existing work
 * item's checklist. That is membership, not a parent link: the new work item
 * still stands on its own in every list, board and timeline, and only the
 * checklist it was added to says it belongs anywhere.
 */
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ExternalLink, Github, ListChecks, Loader2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { cn } from "@plane/utils";
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type TQueueItem = {
  id: string;
  repo: string;
  number: number;
  title: string;
  html_url: string;
  labels: string[];
  github_assignees: string[];
  milestone: string;
  state: string;
  created_at: string | null;
  claimed_by: { id: string; name: string }[];
  suggested_project: string | null;
  suggested_discipline: string | null;
};

/** The work item a row will be filed under, remembered by identifier so the
 *  button can name it without another lookup. */
type TOwner = { id: string; label: string; name: string };

export const GithubTriageRoot = observer(function GithubTriageRoot() {
  const { workspaceSlug } = useParams();
  const [items, setItems] = useState<TQueueItem[] | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState<Record<string, TOwner>>({});
  // The rows the open picker will assign — one, or every chosen row at once,
  // which is the entire point of grouping: three reports, one press, one task.
  const [picking, setPicking] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const slug = workspaceSlug?.toString();

  const load = useCallback(() => {
    if (!slug) return;
    setItems(null);
    service
      .getGithubTriageQueue(slug)
      .then((data) => {
        setItems(data.items);
        setProjects(data.projects);
        // Seeded where a single project claims the repo. Those are rare here by
        // construction — the router took the unambiguous ones — but a repo can
        // be claimed after its issues arrived, and that row needs no thought.
        setChoice(
          Object.fromEntries(data.items.filter((i) => i.suggested_project).map((i) => [i.id, i.suggested_project!]))
        );
        return undefined;
      })
      .catch(() => {
        setItems([]);
        return undefined;
      });
  }, [slug]);

  useEffect(() => load(), [load]);

  const chosen = Object.entries(choice).filter(([, project]) => project);
  const grouped = chosen.filter(([id]) => owner[id]).length;

  const forget = (rowId: string) =>
    setOwner((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });

  // The picker searches one project first and offers the whole workspace, so it
  // opens on the project the rows are going to rather than an arbitrary one.
  const pickingProjectId = picking?.map((id) => choice[id]).find(Boolean) ?? projects[0]?.id;

  const pick = async (selected: ISearchIssueResponse[]) => {
    const target = selected[0];
    if (!target || !picking) return;
    const chosenOwner: TOwner = {
      id: target.id,
      label: `${target.project__identifier}-${target.sequence_id}`,
      name: target.name,
    };
    setOwner((current) => ({
      ...current,
      ...Object.fromEntries(picking.map((rowId) => [rowId, chosenOwner])),
    }));
  };

  const file = async () => {
    if (!slug || chosen.length === 0) return;
    setSaving(true);
    try {
      const result = await service.fileGithubTriage(
        slug,
        chosen.map(([id, project_id]) => ({ id, project_id, checklist_owner_id: owner[id]?.id }))
      );
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${result.filed} filed`,
        message: result.skipped
          ? `${result.skipped} were left — they had already been filed elsewhere.`
          : grouped
            ? `Each one is now a work item in its project, and ${grouped} of them are on a checklist.`
            : "Each one is now a work item in its project, with its discipline and assignee.",
      });
      setChoice({});
      setOwner({});
      load();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't file them",
        message: (error as { error?: string })?.error ?? "Nothing was moved.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:px-6">
      <header>
        <h1 className="flex items-center gap-2 text-16 font-semibold text-primary">
          <Github className="size-4" />
          GitHub triage
        </h1>
        <p className="mt-0.5 text-12 text-tertiary">
          Issues the sync could not route on its own. Everything whose repository belongs to exactly one project is
          filed automatically and never appears here — what is left is the decisions.
        </p>
      </header>

      {items === null ? (
        <p className="text-13 text-tertiary">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-subtle bg-layer-1 px-4 py-6 text-13 text-tertiary">
          Nothing waiting. Every issue the sync has seen belongs to a project — link a repository on a project and its
          issues file themselves from then on.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-subtle bg-layer-1 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-13 text-primary" title={item.title}>
                      {item.title}
                    </span>
                    <a
                      href={item.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-shrink-0 text-tertiary hover:text-primary"
                      aria-label={`Open ${item.repo}#${item.number} on GitHub`}
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-10 text-tertiary">
                    <span>
                      {item.repo}#{item.number}
                    </span>
                    {item.labels.length > 0 && <span>· {item.labels.join(", ")}</span>}
                    {item.github_assignees.length > 0 && <span>· @{item.github_assignees.join(", @")}</span>}
                    {item.milestone && <span>· {item.milestone}</span>}
                    {/* Why this row is here at all. Without it, a repository two
                        projects claim looks identical to one nobody claims, and
                        the answer to each is different. */}
                    {item.claimed_by.length > 1 && (
                      <span className="text-warning-primary">
                        · claimed by {item.claimed_by.map((c) => c.name).join(" and ")}
                      </span>
                    )}
                    {item.claimed_by.length === 0 && <span>· no project names this repository</span>}
                  </div>
                </div>

                <select
                  value={choice[item.id] ?? ""}
                  onChange={(e) => {
                    const projectId = e.target.value;
                    setChoice((c) => ({ ...c, [item.id]: projectId }));
                    // Leaving it here means it is not going anywhere, so where it
                    // was going is no longer an answer worth keeping.
                    if (!projectId) forget(item.id);
                  }}
                  aria-label={`Project for ${item.title}`}
                  className="w-56 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
                >
                  <option value="">Leave it here</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                {/* The second decision, and it has a default: a work item of its
                    own. Shown even before a project is picked so the default is
                    read rather than discovered after the fact. */}
                <div className="flex w-44 flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!choice[item.id]}
                    onClick={() => setPicking([item.id])}
                    title={
                      owner[item.id]
                        ? `On the checklist of ${owner[item.id].name}`
                        : "Put it on an existing work item's checklist instead"
                    }
                    className={cn(
                      "min-w-0 flex-1 truncate rounded border border-subtle px-2 py-1 text-left text-11",
                      choice[item.id] ? "text-secondary hover:text-primary" : "text-tertiary opacity-50",
                      owner[item.id] && "text-primary"
                    )}
                  >
                    {owner[item.id] ? `On ${owner[item.id].label}` : "Its own work item"}
                  </button>
                  {owner[item.id] && (
                    <button
                      type="button"
                      onClick={() => forget(item.id)}
                      aria-label={`Give ${item.title} its own work item instead`}
                      className="flex-shrink-0 text-tertiary hover:text-primary"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-11 text-tertiary">
              {items.length} waiting · {chosen.length} chosen
              {grouped > 0 && ` · ${grouped} on a checklist`}
            </span>
            {/* Grouping row by row would mean picking the same work item as many
                times as there are reports of the same bug. */}
            {chosen.length > 1 && (
              <button
                type="button"
                onClick={() => setPicking(chosen.map(([id]) => id))}
                className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-12 text-secondary hover:text-primary"
              >
                <ListChecks className="size-3.5" />
                Put all {chosen.length} on one checklist
              </button>
            )}
            <button
              type="button"
              onClick={() => void file()}
              disabled={saving || chosen.length === 0}
              className={cn(
                "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
                saving || chosen.length === 0 ? "opacity-50" : "hover:opacity-90"
              )}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              File {chosen.length}
            </button>
          </div>
        </>
      )}

      {slug && pickingProjectId && (
        <ExistingIssuesListModal
          workspaceSlug={slug}
          projectId={pickingProjectId}
          isOpen={picking !== null}
          handleClose={() => setPicking(null)}
          // Nothing to exclude: the work items these rows will become do not
          // exist yet, so no choice here can point at itself.
          searchParams={{}}
          handleOnSubmit={pick}
          workspaceLevelToggle
        />
      )}
    </div>
  );
});
