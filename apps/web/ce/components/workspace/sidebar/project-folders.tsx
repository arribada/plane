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

// transient drag sources (a project id, or a folder id) — DnD is a same-frame
// gesture, and only one of the two is ever set.
let dragProjectId: string | null = null;
let dragFolderId: string | null = null;

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

  /** Walks up from `candidate`; the hop cap is a backstop against data that is
   *  already cyclic, which would otherwise spin here forever. */
  const isSelfOrDescendant = (candidateId: string, ofId: string) => {
    let cursor: TFolder | undefined = byId.get(candidateId);
    let hops = 0;
    while (cursor && hops < 64) {
      if (cursor.id === ofId) return true;
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      hops += 1;
    }
    return false;
  };

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
    await service.assignProjectToFolder(ws, projectId, folderId);
    refetch();
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

  /** What a drop on this folder would do, or null if the gesture is not allowed. */
  const dropAction = (targetId: string) => {
    if (dragProjectId) return () => assign(dragProjectId!, targetId);
    if (dragFolderId && !isSelfOrDescendant(targetId, dragFolderId)) {
      const moving = dragFolderId;
      return () => nest(moving, targetId);
    }
    return null;
  };

  const clearDrag = () => {
    dragProjectId = null;
    dragFolderId = null;
    setDropTarget(null);
  };

  const renderFolder = (f: TFolder, depth: number) => {
    const isOpen = open.has(f.id);
    const children = childrenOf.get(f.id) ?? [];
    const matches = query.trim()
      ? unassigned.filter((pid) => norm(getProjectById(pid)?.name ?? "").includes(norm(query)))
      : unassigned;

    return (
      <div key={f.id}>
        <div
          draggable
          onDragStart={() => {
            dragFolderId = f.id;
            dragProjectId = null;
          }}
          onDragEnd={clearDrag}
          className={cn(
            "group flex items-center gap-1 rounded py-1 pr-2 hover:bg-layer-transparent-hover",
            dropTarget === f.id && "outline outline-1 outline-accent-strong/60"
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onDragOver={(e) => {
            if (!dropAction(f.id)) return;
            // preventDefault is what MAKES an element a drop target; without it
            // the browser refuses the drop and nothing ever fires.
            e.preventDefault();
            setDropTarget(f.id);
          }}
          onDragLeave={() => setDropTarget((id) => (id === f.id ? null : id))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const action = dropAction(f.id);
            clearDrag();
            if (action) void action();
          }}
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
                draggable
                onDragStart={(e) => {
                  // Sibling of the folder header, not a child, so this does not
                  // bubble — but both transients are set explicitly anyway.
                  e.stopPropagation();
                  dragProjectId = pid;
                  dragFolderId = null;
                }}
                onDragEnd={clearDrag}
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
      <div
        className={cn(
          "group flex items-center justify-between rounded px-2 py-1",
          dropTarget === "__root__" && "outline outline-1 outline-accent-strong/60"
        )}
        // Dropping a folder on the header pulls it back to the top level, which
        // is the only way out of a nesting once it is in one.
        onDragOver={(e) => {
          if (!dragFolderId) return;
          e.preventDefault();
          setDropTarget("__root__");
        }}
        onDragLeave={() => setDropTarget((id) => (id === "__root__" ? null : id))}
        onDrop={(e) => {
          e.preventDefault();
          const moving = dragFolderId;
          clearDrag();
          if (moving) void nest(moving, null);
        }}
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
