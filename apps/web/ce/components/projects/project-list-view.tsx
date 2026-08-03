/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The projects page as rows, grouped by the folder a project belongs to.
 *
 * The gallery is three cards per row on a wide screen, so twenty-four projects is
 * eight rows of scrolling to answer "which ones are late" — and no two cards line
 * their dates up, because each is its own box. A table answers that in one look,
 * which is the whole reason a table exists.
 *
 * Grouping reuses ProjectFolder, the shared folders that already organise the
 * sidebar and the portfolio, rather than inventing a second way to say the same
 * thing. A project filed once is filed everywhere.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronRight, FolderPlus } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioProject } from "@/plane-web/types/arribada";
import { projectHealth } from "@/plane-web/components/portfolio/colors";

const service = new ArribadaService();

/** Projects in no folder still have to go somewhere, and saying so beats a blank
 *  heading that reads like a bug. */
const UNFILED = "__unfiled__";

type Props = {
  projectIds: string[];
};

export const ProjectListView = observer(function ProjectListView({ projectIds }: Props) {
  const { workspaceSlug } = useParams();
  // The portfolio payload, not the project store: this fork keeps a project's
  // dates in its own ProjectSchedule, so TProject has none — and the same call
  // carries the derived dates and the item counts, which is most of what makes a
  // table worth having over cards.
  const [rows, setRows] = useState<Record<string, TPortfolioProject>>({});
  const [folders, setFolders] = useState<{ id: string; name: string; project_ids: string[] }[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;
    // A failure here costs the grouping, not the list: everything falls into
    // "Not in a mission" and the page still does its job.
    service
      .getFolders(workspaceSlug.toString())
      .then((found) => {
        if (!cancelled) setFolders(found.map((f) => ({ id: f.id, name: f.name, project_ids: f.project_ids })));
        return undefined;
      })
      .catch(() => undefined);
    service
      .getPortfolio(workspaceSlug.toString())
      .then((projects) => {
        if (!cancelled) setRows(Object.fromEntries(projects.map((p) => [p.id, p])));
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  const groups = useMemo(() => {
    const byProject = new Map<string, { id: string; name: string }>();
    for (const folder of folders) for (const id of folder.project_ids) byProject.set(id, folder);

    const buckets = new Map<string, { name: string; ids: string[] }>();
    for (const id of projectIds) {
      const folder = byProject.get(id);
      const key = folder?.id ?? UNFILED;
      const bucket = buckets.get(key);
      if (bucket) bucket.ids.push(id);
      else buckets.set(key, { name: folder?.name ?? "Not in a mission", ids: [id] });
    }

    // Named folders first, alphabetically; the unfiled bucket last, because it is
    // a residue rather than a mission.
    const named = [...buckets.entries()].filter(([key]) => key !== UNFILED);
    named.sort((a, b) => a[1].name.localeCompare(b[1].name));
    const unfiled = buckets.get(UNFILED);
    return [...named, ...(unfiled ? ([[UNFILED, unfiled]] as typeof named) : [])];
  }, [folders, projectIds]);

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * Moving a project between missions.
   *
   * Native HTML5 drag rather than a library: a row is already a link, the drop
   * targets are the section headers that are already on screen, and pulling in a
   * drag-and-drop dependency to move one row between two lists would be more
   * machinery than the feature.
   *
   * The grouping is recomputed optimistically so the row lands where it was
   * dropped, then corrected from the server — a row that snaps back for a second
   * before settling reads as a bug even when the write succeeded.
   */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const moveToFolder = async (projectId: string, folderKey: string) => {
    if (!workspaceSlug) return;
    const folderId = folderKey === UNFILED ? null : folderKey;
    const before = folders;
    setFolders((current) =>
      current.map((f) => ({
        ...f,
        project_ids:
          f.id === folderId
            ? [...f.project_ids.filter((id) => id !== projectId), projectId]
            : f.project_ids.filter((id) => id !== projectId),
      }))
    );
    try {
      await service.assignProjectToFolder(workspaceSlug.toString(), projectId, folderId);
    } catch {
      setFolders(before);
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't move it", message: "The project stayed where it was." });
    }
  };

  const newMission = async () => {
    if (!workspaceSlug) return;
    const name = window.prompt("Name the mission");
    if (!name?.trim()) return;
    try {
      const created = await service.createFolder(workspaceSlug.toString(), name.trim());
      setFolders((current) => [...current, { id: created.id, name: created.name, project_ids: [] }]);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't create the mission" });
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 md:px-6">
      <button
        type="button"
        onClick={() => void newMission()}
        className="flex items-center gap-1.5 self-start rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2 hover:text-primary"
      >
        <FolderPlus className="size-3.5" />
        New mission
      </button>
      {groups.map(([key, group]) => {
        const open = !collapsed.has(key);
        return (
          <section
            key={key}
            onDragOver={(e) => {
              if (!dragging) return;
              // preventDefault is what MAKES an element a drop target; without
              // it the browser refuses the drop and nothing ever fires.
              e.preventDefault();
              setOver(key);
            }}
            onDragLeave={() => setOver((k) => (k === key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragging ?? e.dataTransfer.getData("text/plain");
              setOver(null);
              setDragging(null);
              if (id) void moveToFolder(id, key);
            }}
            className={cn("rounded-lg", over === key && "outline outline-2 outline-accent-strong/50")}
          >
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={open}
              className="mb-1 flex w-full items-center gap-1.5 py-1 text-left text-12 font-medium text-secondary hover:text-primary"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              {group.name}
              <span className="font-normal text-11 text-tertiary">· {group.ids.length}</span>
            </button>

            {open && (
              <div className="overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full min-w-[42rem] text-13">
                  <thead>
                    <tr className="border-b border-subtle bg-layer-2 text-11 text-tertiary">
                      <th className="px-3 py-2 text-left font-medium">Project</th>
                      <th className="w-28 px-3 py-2 text-left font-medium">Start</th>
                      <th className="w-28 px-3 py-2 text-left font-medium">Target</th>
                      {/* What the plan actually implies, beside what was promised.
                          The gap between the two IS the reading. */}
                      <th className="w-28 px-3 py-2 text-left font-medium">Now ends</th>
                      <th className="w-32 px-3 py-2 text-left font-medium">Work</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.ids.map((id) => {
                      const row = rows[id];
                      if (!row) return null;
                      const health = projectHealth({
                        target_date: row.target_date,
                        derived_target_date: row.derived_target_date,
                      });
                      return (
                        <tr
                          key={id}
                          draggable
                          onDragStart={(e) => {
                            setDragging(id);
                            e.dataTransfer.setData("text/plain", id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          className={cn(
                            "cursor-grab border-b border-subtle last:border-0 hover:bg-layer-1",
                            dragging === id && "opacity-40"
                          )}
                        >
                          <td className="px-3 py-2">
                            <a
                              href={`/${workspaceSlug}/projects/${id}/overview`}
                              className="flex items-center gap-2 font-medium text-primary hover:text-accent-primary hover:underline"
                            >
                              {/* Colour AND a glyph: red/green on a dot is unreadable
                                  for a deuteranope and gone from a screenshot. */}
                              {health && (
                                <span
                                  role="img"
                                  aria-label={health.label}
                                  title={health.label}
                                  className="flex size-3.5 flex-shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-bold text-white"
                                  style={{ backgroundColor: health.color }}
                                >
                                  {health.glyph}
                                </span>
                              )}
                              <span className="truncate">{row.name}</span>
                              <span className="flex-shrink-0 text-11 text-tertiary">{row.identifier}</span>
                            </a>
                          </td>
                          <td className="px-3 py-2 text-secondary tabular-nums">
                            {renderFormattedDate(row.start_date) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-secondary tabular-nums">
                            {renderFormattedDate(row.target_date) ?? "—"}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 tabular-nums",
                              health?.glyph === "!" ? "font-medium text-danger-primary" : "text-secondary"
                            )}
                          >
                            {renderFormattedDate(row.derived_target_date) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-secondary">
                            {row.completed_item_count}/{row.item_count}
                            {row.undated_item_count > 0 && (
                              <span
                                className="ml-1.5 text-11 text-tertiary"
                                title={`${row.undated_item_count} with no dates — on no timeline`}
                              >
                                +{row.undated_item_count} undated
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
});
