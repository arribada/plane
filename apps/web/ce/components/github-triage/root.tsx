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
 * answer, and the row already names the candidates, so the names ARE the
 * control: clicking one is the answer. The same row also offers to settle the
 * repository itself, which is the answer to every issue it will ever produce,
 * and that one asks first because it rewrites another project's settings.
 *
 * The second question is whether an issue deserves a work item of its own.
 * Often several of them are one task, so a row can instead join an existing work
 * item's checklist. That is membership, not a parent link: the new work item
 * still stands on its own in every list, board and timeline, and only the
 * checklist it was added to says it belongs anywhere.
 *
 * The third answer is that there is no answer: noise, a duplicate, a wontfix.
 * Until there was an archive the only exit was to file it somewhere, so the list
 * was cleared by polluting a project — and the row came back on the next sync
 * regardless. Dismissing writes to the record the sync itself reads, so it stays
 * gone, and the archive at the foot of the page is how a mistake is undone.
 */
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Archive, ChevronRight, ExternalLink, Github, ListChecks, Loader2, Undo2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { AlertModalCore } from "@plane/ui";
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

type TArchivedItem = {
  id: string;
  repo: string;
  number: number;
  title: string;
  html_url: string;
  dismissed_at: string | null;
};

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
  const [archived, setArchived] = useState<TArchivedItem[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Rows mid-flight, so a second click cannot dismiss the same one twice while
  // the first request is still out.
  const [busyRows, setBusyRows] = useState<string[]>([]);
  // The row whose repository is about to be settled for good, held while the
  // confirmation is open. Held as the row rather than as ids because the
  // confirmation has to name the projects that lose the link, and the row is
  // the only thing that knows them.
  const [settling, setSettling] = useState<TQueueItem | null>(null);
  const [settlingBusy, setSettlingBusy] = useState(false);

  const slug = workspaceSlug?.toString();

  const loadArchive = useCallback(() => {
    if (!slug) return;
    service
      .getGithubTriageArchive(slug)
      .then((data) => {
        setArchived(data.items);
        return undefined;
      })
      .catch(() => {
        // The archive is a second opinion on a page that works without it.
        setArchived([]);
        return undefined;
      });
  }, [slug]);

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
        //
        // Merged UNDER what is already chosen, never over it. A reload is not
        // always a fresh page — restoring one row from the archive reloads the
        // queue too — and replacing the map there would quietly throw away every
        // answer somebody had given but not yet filed.
        setChoice((current) => ({
          ...Object.fromEntries(data.items.filter((i) => i.suggested_project).map((i) => [i.id, i.suggested_project!])),
          ...current,
        }));
        return undefined;
      })
      .catch(() => {
        setItems([]);
        return undefined;
      });
  }, [slug]);

  useEffect(() => load(), [load]);
  useEffect(() => loadArchive(), [loadArchive]);

  const chosen = Object.entries(choice).filter(([, project]) => project);
  const grouped = chosen.filter(([id]) => owner[id]).length;

  const forget = (rowId: string) =>
    setOwner((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });

  const dismiss = async (row: TQueueItem) => {
    if (!slug) return;
    setBusyRows((current) => [...current, row.id]);
    try {
      await service.dismissGithubTriage(slug, [row.id]);
      // Removed here rather than by reloading the queue: a reload would also
      // discard every other project choice on the page, which is somebody's
      // work in progress and nothing to do with this row.
      setItems((current) => (current ?? []).filter((i) => i.id !== row.id));
      setChoice((c) => {
        const next = { ...c };
        delete next[row.id];
        return next;
      });
      forget(row.id);
      loadArchive();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't archive it",
        message: (error as { error?: string })?.error ?? "It is still in the queue.",
      });
    } finally {
      setBusyRows((current) => current.filter((id) => id !== row.id));
    }
  };

  const restore = async (row: TArchivedItem) => {
    if (!slug) return;
    setBusyRows((current) => [...current, row.id]);
    try {
      await service.restoreGithubTriage(slug, [row.id]);
      setArchived((current) => current.filter((i) => i.id !== row.id));
      // Reloaded because only the server knows where the row sorts and who
      // claims its repo. Safe for anything already chosen on the page: `load`
      // merges its suggestions under the current choices rather than over them.
      load();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't restore it",
        message: (error as { error?: string })?.error ?? "It is still archived.",
      });
    } finally {
      setBusyRows((current) => current.filter((id) => id !== row.id));
    }
  };

  /** The claimant picked for this row, if the pick is one of the claimants.
   *  Settling the repository on a project that never claimed it is a different
   *  and much larger act than resolving a contest, so it is not offered here. */
  const claimantChosen = (item: TQueueItem) => item.claimed_by.find((c) => c.id === choice[item.id]) ?? null;

  const settle = async () => {
    const winner = settling && claimantChosen(settling);
    if (!slug || !settling || !winner) return;
    setSettlingBusy(true);
    try {
      const result = await service.claimGithubRepo(slug, settling.repo, winner.id);
      const lost = result.removed_from.map((p) => p.name).join(", ");
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${settling.repo} is ${winner.name}'s`,
        message: result.untouched.length
          ? `Unlinked from ${lost || "nobody else"}. ${result.untouched
              .map((p) => p.name)
              .join(", ")} still claims it and is outside your access, so its issues may keep arriving here.`
          : lost
            ? `Unlinked from ${lost}. Its future issues file themselves.`
            : "Nothing else claimed it, so its future issues already file themselves.",
      });
      setSettling(null);
      // The whole queue, not just this row: settling a repository changes where
      // every other row from it is going, and leaving them saying "claimed by
      // two projects" would be a lie the page told about its own last action.
      load();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't settle it",
        message: (error as { error?: string })?.error ?? "No project's links were changed.",
      });
    } finally {
      setSettlingBusy(false);
    }
  };

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
                        the answer to each is different.

                        The names are the answer, so they are the control. Reading
                        "claimed by Firmware and Hardware" and then hunting for one
                        of those two words in a list of twenty-three is the same
                        decision made twice, and the second time is where it goes
                        wrong. */}
                    {item.claimed_by.length > 1 && (
                      <span className="text-warning-primary">
                        ·{" "}
                        {item.claimed_by.map((c, index) => (
                          <span key={c.id}>
                            {index === 0 ? "claimed by " : " and "}
                            <button
                              type="button"
                              onClick={() => setChoice((current) => ({ ...current, [item.id]: c.id }))}
                              title={`File this one in ${c.name}`}
                              className={cn(
                                "underline decoration-dotted underline-offset-2 hover:text-primary",
                                choice[item.id] === c.id && "font-medium text-primary no-underline"
                              )}
                            >
                              {c.name}
                            </button>
                          </span>
                        ))}
                        {/* The other half of the answer: this row, or this repo
                            for good. Offered only once a claimant is chosen, so
                            the sentence it completes is already on screen. */}
                        {claimantChosen(item) && (
                          <button
                            type="button"
                            onClick={() => setSettling(item)}
                            title={`Give ${item.repo} to this project permanently and unlink it from the others`}
                            className="ml-1.5 text-tertiary underline decoration-dotted underline-offset-2 hover:text-primary"
                          >
                            always
                          </button>
                        )}
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

                {/* The third answer. Filing was the only way off this list, so a
                    duplicate or a wontfix could only be cleared by creating work
                    for it somewhere. */}
                <button
                  type="button"
                  disabled={busyRows.includes(item.id)}
                  onClick={() => void dismiss(item)}
                  title="Archive it — no project, and the sync will not bring it back"
                  aria-label={`Archive ${item.title} without filing it`}
                  className={cn(
                    "flex-shrink-0 text-tertiary hover:text-primary",
                    busyRows.includes(item.id) && "opacity-50"
                  )}
                >
                  {busyRows.includes(item.id) ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                </button>
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

      {/* Collapsed, and at the foot of the page, because it is a record rather
          than a queue: nothing here is waiting on anybody. It is rendered
          outside the queue's own branch so it stays reachable on the day the
          queue is finally empty — which is the day somebody is most likely to
          wonder where a row went. */}
      {archived.length > 0 && (
        <section className="mt-2">
          <button
            type="button"
            onClick={() => setArchiveOpen((open) => !open)}
            aria-expanded={archiveOpen}
            className="flex w-full items-center gap-1.5 rounded-lg border border-subtle bg-layer-1 px-3 py-2 text-12 text-secondary hover:text-primary"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", archiveOpen && "rotate-90")} />
            Archived ({archived.length})
            <span className="ml-auto text-10 text-tertiary">Set aside — the sync will not re-offer them</span>
          </button>

          {archiveOpen && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {archived.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-x-3 rounded-lg border border-subtle bg-layer-1 px-3 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-12 text-secondary" title={row.title}>
                        {row.title}
                      </span>
                      <a
                        href={row.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 text-tertiary hover:text-primary"
                        aria-label={`Open ${row.repo}#${row.number} on GitHub`}
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <span className="text-10 text-tertiary">
                      {row.repo}#{row.number}
                      {row.dismissed_at && ` · archived ${new Date(row.dismissed_at).toLocaleDateString()}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busyRows.includes(row.id)}
                    onClick={() => void restore(row)}
                    className={cn(
                      "flex flex-shrink-0 items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary hover:text-primary",
                      busyRows.includes(row.id) && "opacity-50"
                    )}
                  >
                    {busyRows.includes(row.id) ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Undo2 className="size-3" />
                    )}
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Spelled out rather than summarised. This unlinks a repository from a
          project somebody else set up, and the only honest way to ask is to name
          the project and say what it loses. */}
      <AlertModalCore
        isOpen={settling !== null}
        handleClose={() => setSettling(null)}
        handleSubmit={() => void settle()}
        isSubmitting={settlingBusy}
        variant="primary"
        title={settling ? `Give ${settling.repo} to ${claimantChosen(settling)?.name ?? ""}?` : ""}
        primaryButtonText={{ default: "Settle it", loading: "Settling" }}
        content={
          settling ? (
            <span>
              {settling.repo} will be linked to <b>{claimantChosen(settling)?.name}</b> only. It will be removed from
              the linked repositories of{" "}
              <b>
                {settling.claimed_by
                  .filter((c) => c.id !== choice[settling.id])
                  .map((c) => c.name)
                  .join(" and ")}
              </b>
              , which changes those projects' settings. Every future issue from this repository will then file itself
              into {claimantChosen(settling)?.name} without passing through this page. Issues already waiting here are
              not moved.
            </span>
          ) : (
            ""
          )
        }
      />

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
