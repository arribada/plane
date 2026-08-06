/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Workspace-shared project folders in the sidebar (like AFFiNE): a project lead
 * groups projects for the whole team. All state is server-side via the
 * /project-folders/ endpoints.
 *
 * Folders nest. The model always allowed it — `parent` has been a self-FK since
 * the first migration — but nothing here ever drew a tree or offered to make one,
 * so a capability that existed in the database was unreachable from the product.
 *
 * A project still belongs to exactly one folder. Nesting is for filing the
 * folders, not for filing a project twice.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Folder,
  GanttChartSquare,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type TFolder = { id: string; name: string; parent_id: string | null; sort_order: number; project_ids: string[] };

/** What is being dragged. One value rather than two transients that had to agree
 *  — the pair made "a project drag still carrying a folder id" representable, and
 *  every reader had to check both to find out which one was live. */
export type TDragSource = { kind: "project" | "folder"; id: string };

/** Where a drop landed: a folder's id, or the FOLDERS header — the top level. */
export const ROOT_DROP = "__root__";

/**
 * What a drop should DO. Plain data, deliberately, and this is the whole point.
 *
 * It used to be a function returning `() => assign(dragProjectId!, targetId)`,
 * and `onDrop` called `clearDrag()` before running it. The closure re-read the
 * drag source at call time, by which point it had been nulled: EVERY project
 * dropped on a folder called assign() with a null project id, the server answered
 * 400 "project_id required", nothing caught the rejection, and the sidebar showed
 * the project exactly where it had been. Top-level folder or nested one made no
 * difference — the id was already gone before the target was ever consulted.
 *
 * An intent resolved up front cannot go stale between the decision and the act.
 */
export type TDropIntent =
  | { kind: "assign"; projectId: string; folderId: string | null }
  | { kind: "nest"; folderId: string; parentId: string | null };

/** Whether walking up from `startId` reaches `ofId`. Mirrors the server's
 *  `_folder_reaches`; the hop cap is a backstop against data that is already
 *  cyclic, which would otherwise spin here forever. */
const reachesUp = (startId: string, ofId: string, parentOf: ReadonlyMap<string, string | null>): boolean => {
  let cursor: string | null = startId;
  let hops = 0;
  while (cursor && hops < 64) {
    if (cursor === ofId) return true;
    cursor = parentOf.get(cursor) ?? null;
    hops += 1;
  }
  return false;
};

/**
 * The one place that decides what a drop means, given only its inputs.
 *
 * Exported because jsdom cannot perform a drag — but the bug this replaced was
 * never in the gesture, it was in this decision, and a pure function of
 * (what is held, where it was let go, the shape of the tree) can be tested
 * exhaustively without one.
 */
export const resolveDrop = (
  drag: TDragSource | null,
  target: string,
  parentOf: ReadonlyMap<string, string | null>
): TDropIntent | null => {
  if (!drag) return null;
  // The header is the top level: for a project that means "no folder", for a
  // folder "not nested" — the only way back out of a nesting once it is in one.
  const folderId = target === ROOT_DROP ? null : target;
  // A project belongs to exactly one folder, so any folder will take it — the
  // depth of the target has never had anything to say about it.
  if (drag.kind === "project") return { kind: "assign", projectId: drag.id, folderId };
  // A folder moved inside its own subtree stops being reachable from the root.
  // The server refuses it too; refusing it here is what stops the drop being
  // offered at all.
  if (folderId && reachesUp(folderId, drag.id, parentOf)) return null;
  return { kind: "nest", folderId: drag.id, parentId: folderId };
};

// A named property escape, not a literal range: the combining marks are
// invisible in source, so a range written out is a class nobody can read and
// any tool that renormalises the file can quietly break.
const COMBINING_MARKS = /\p{Diacritic}/gu;

/** Accent- and case-insensitive, so "recepteur" finds "Récepteur". */
const norm = (value: string) => value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

export const SidebarProjectFolders = observer(function SidebarProjectFolders() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const { getProjectById, joinedProjectIds } = useProject();
  const service = useMemo(() => new ArribadaService(), []);
  const [folders, setFolders] = useState<TFolder[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // A ref, not state: a drag is a same-frame gesture and nothing renders from it
  // — the outline is driven by `dropTarget`. A ref rather than a module-level
  // variable so it dies with the component instead of outliving a remount.
  const dragSource = useRef<TDragSource | null>(null);

  // Only one picker is open at a time, so one ref is enough; focusing it here
  // means opening the picker and typing are the same gesture.
  useEffect(() => {
    if (addingTo) searchRef.current?.focus();
  }, [addingTo]);

  const ws = workspaceSlug?.toString();

  const refetch = () => {
    if (!ws) return;
    service
      .getFolders(ws)
      .then((f) => setFolders(f || []))
      .catch(() => setFolders([]));
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const assignedIds = useMemo(() => new Set(folders.flatMap((f) => f.project_ids)), [folders]);
  const unassigned = joinedProjectIds.filter((id) => !assignedIds.has(id));

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  /** Children keyed by parent. A folder whose parent has gone missing is shown at
   *  the top level rather than dropped — losing a folder is worse than misfiling it. */
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TFolder[]>();
    for (const f of folders) {
      const key = f.parent_id && byId.has(f.parent_id) ? f.parent_id : null;
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [folders, byId]);

  /** Projects in this folder and everything under it — a grouping folder showing
   *  "0" while its subfolders hold five reads as broken. */
  const totalProjects = (folder: TFolder): number =>
    folder.project_ids.length + (childrenOf.get(folder.id) ?? []).reduce((sum, child) => sum + totalProjects(child), 0);

  /** Folder → its parent, with a parent that has gone missing read as "top level"
   *  — the same rule `childrenOf` applies, so the map a drop is judged against and
   *  the tree on screen can never disagree about the shape of things. */
  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const f of folders) map.set(f.id, f.parent_id && byId.has(f.parent_id) ? f.parent_id : null);
    return map;
  }, [folders, byId]);

  const createFolder = async (parentId: string | null) => {
    if (!ws) return;
    const name = window.prompt(parentId ? "Name the subfolder" : "Folder name");
    if (!name?.trim()) return;
    await service.createFolder(ws, name.trim(), parentId);
    if (parentId) setOpen((prev) => new Set(prev).add(parentId));
    refetch();
  };
  const rename = async (f: TFolder) => {
    if (!ws) return;
    const name = window.prompt("Rename folder", f.name);
    if (!name?.trim()) return;
    await service.renameFolder(ws, f.id, name.trim());
    refetch();
  };
  const del = async (f: TFolder) => {
    const hasChildren = (childrenOf.get(f.id) ?? []).length > 0;
    const warning = hasChildren
      ? `Delete folder "${f.name}"? Its subfolders move up a level; no project is deleted.`
      : `Delete folder "${f.name}"? Projects inside are not deleted.`;
    if (!ws || !window.confirm(warning)) return;
    await service.deleteFolder(ws, f.id);
    refetch();
  };
  const assign = async (projectId: string, folderId: string | null) => {
    if (!ws) return;
    setAddingTo(null);
    try {
      await service.assignProjectToFolder(ws, projectId, folderId);
      // Open the destination. A project dropped into a collapsed folder lands
      // somewhere nobody can see, which reads as "nothing happened" — the same
      // complaint, from a write that actually succeeded.
      if (folderId) setOpen((prev) => new Set(prev).add(folderId));
      refetch();
    } catch (error) {
      // Silence here is how the real bug stayed invisible: the write was
      // rejected on every drop and nothing on screen ever said so.
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't move that project",
        message: (error as { error?: string })?.error ?? "It stayed where it was.",
      });
    }
  };
  const nest = async (folderId: string, parentId: string | null) => {
    if (!ws) return;
    try {
      await service.moveFolder(ws, folderId, parentId);
      if (parentId) setOpen((prev) => new Set(prev).add(parentId));
      refetch();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't move that folder",
        message: (error as { error?: string })?.error ?? "It stayed where it was.",
      });
    }
  };

  const clearDrag = () => {
    dragSource.current = null;
    setDropTarget(null);
  };

  const applyDrop = (intent: TDropIntent) =>
    intent.kind === "assign" ? assign(intent.projectId, intent.folderId) : nest(intent.folderId, intent.parentId);

  /** Every drop target's three handlers, written once. Two things they all have
   *  to get right: `preventDefault` in dragOver — which is what MAKES an element
   *  a drop target, without it the browser refuses the drop and nothing fires —
   *  and reading the intent BEFORE clearing the drag. */
  const dropHandlers = (target: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!resolveDrop(dragSource.current, target, parentOf)) return;
      e.preventDefault();
      setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((id) => (id === target ? null : id)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const intent = resolveDrop(dragSource.current, target, parentOf);
      clearDrag();
      if (intent) void applyDrop(intent);
    },
  });

  /** Marks the element as the thing being dragged. The `setData` call is not
   *  decoration: Firefox refuses to start a drag at all unless the gesture
   *  carries data, so without it neither projects nor folders could be dragged
   *  there. The payload is only a fallback — the ref is what the drop reads. */
  const dragHandlers = (source: TDragSource) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.stopPropagation();
      dragSource.current = source;
      e.dataTransfer.setData("text/plain", source.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: clearDrag,
  });

  const renderFolder = (f: TFolder, depth: number) => {
    const isOpen = open.has(f.id);
    const children = childrenOf.get(f.id) ?? [];
    const matches = query.trim()
      ? unassigned.filter((pid) => norm(getProjectById(pid)?.name ?? "").includes(norm(query)))
      : unassigned;

    return (
      <div key={f.id}>
        <div
          {...dragHandlers({ kind: "folder", id: f.id })}
          {...dropHandlers(f.id)}
          className={cn(
            "group flex items-center gap-1 rounded py-1 pr-2 hover:bg-layer-transparent-hover",
            dropTarget === f.id && "outline outline-1 outline-accent-strong/60"
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <button
            type="button"
            onClick={() =>
              setOpen((prev) => {
                const n = new Set(prev);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              })
            }
            className="flex min-w-0 flex-grow items-center gap-1.5 text-left text-13 text-secondary"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 flex-shrink-0" />
            )}
            <Folder className="size-3.5 flex-shrink-0 text-tertiary" />
            <span className="truncate">{f.name}</span>
            <span
              className="flex-shrink-0 text-11 text-placeholder"
              title={children.length > 0 ? "Projects here and in its subfolders" : "Projects in this folder"}
            >
              {totalProjects(f)}
            </span>
          </button>
          <div className="relative flex flex-shrink-0 items-center opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => ws && router.push(`/${ws}/portfolio?folder=${f.id}`)}
              title="Open this folder in the portfolio timeline"
              className="text-placeholder hover:text-secondary"
            >
              <GanttChartSquare className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setAddingTo(addingTo === f.id ? null : f.id);
              }}
              title="Add project"
              className="ml-1 text-placeholder hover:text-secondary"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void createFolder(f.id)}
              title="New subfolder"
              className="ml-1 text-placeholder hover:text-secondary"
            >
              <FolderPlus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => rename(f)}
              title="Rename"
              className="ml-1 text-placeholder hover:text-secondary"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => del(f)}
              title="Delete folder"
              className="ml-1 text-placeholder hover:text-danger-primary"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {addingTo === f.id && (
          <div
            className="mb-1 rounded border border-subtle bg-layer-1 p-1"
            style={{ marginLeft: `${20 + depth * 12}px` }}
          >
            {/* Typing beats scrolling once there are more than a handful of
                projects, and the list stays right underneath. */}
            <input
              // Focused from an effect rather than autoFocus: the attribute is a
              // page-load hazard the linter rightly refuses, but this input only
              // exists once the user has asked for it.
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAddingTo(null);
                }
                // Enter takes the top match, so the common case is a few letters
                // and a keypress rather than a hunt down the list.
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  void assign(matches[0], f.id);
                }
              }}
              placeholder="Search projects…"
              aria-label={`Search a project to add to ${f.name}`}
              className="mb-1 w-full rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
            />
            <div className="max-h-48 overflow-y-auto">
              {unassigned.length === 0 ? (
                <div className="px-2 py-1 text-11 text-placeholder">All projects are already in a folder.</div>
              ) : matches.length === 0 ? (
                <div className="px-2 py-1 text-11 text-placeholder">No project left to file matches that.</div>
              ) : (
                matches.map((pid) => (
                  <button
                    type="button"
                    key={pid}
                    onClick={() => assign(pid, f.id)}
                    className="flex w-full items-center rounded px-2 py-1 text-left text-12 text-secondary hover:bg-layer-2"
                  >
                    {getProjectById(pid)?.name ?? pid}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {isOpen && (
          <>
            {f.project_ids.map((pid) => (
              <div
                key={pid}
                {...dragHandlers({ kind: "project", id: pid })}
                className="group/item flex cursor-grab items-center gap-1 rounded py-0.5 pr-2 hover:bg-layer-transparent-hover"
                style={{ paddingLeft: `${28 + depth * 12}px` }}
              >
                <button
                  type="button"
                  onClick={() => router.push(`/${ws}/projects/${pid}/overview/`)}
                  className={cn("flex-grow truncate text-left text-13 text-secondary hover:text-primary")}
                >
                  {getProjectById(pid)?.name ?? pid}
                </button>
                <button
                  type="button"
                  onClick={() => assign(pid, null)}
                  title="Remove from folder"
                  className="text-placeholder opacity-0 group-hover/item:opacity-100 hover:text-danger-primary"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {children.map((child) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  if (folders.length === 0) {
    return (
      <button
        type="button"
        onClick={() => void createFolder(null)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-11 text-placeholder hover:bg-layer-transparent-hover hover:text-secondary"
      >
        <FolderPlus className="size-3.5" />
        New project folder
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      {/* The header is the top level. A folder dropped here comes back out of its
          nesting — and so does a PROJECT, which the header used to refuse: it
          tested the folder transient alone, so the only way to unfile a project
          was the little × on its row, and dragging it out did nothing. Same
          handlers as any other target, so the two can no longer drift apart. */}
      <div
        {...dropHandlers(ROOT_DROP)}
        className={cn(
          "group flex items-center justify-between rounded px-2 py-1",
          dropTarget === ROOT_DROP && "outline outline-1 outline-accent-strong/60"
        )}
      >
        <span className="text-11 font-semibold tracking-wide text-placeholder uppercase">Folders</span>
        <button
          type="button"
          onClick={() => void createFolder(null)}
          title="New folder"
          className="text-placeholder hover:text-secondary"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>
      {(childrenOf.get(null) ?? []).map((f) => renderFolder(f, 0))}
    </div>
  );
});
