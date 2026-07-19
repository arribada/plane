/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Workspace-shared project folders in the sidebar (like AFFiNE): a project lead
 * groups projects for the whole team. Menu-based assignment (no drag) for a first
 * cut; all state is server-side via the /project-folders/ endpoints.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, FolderPlus, Folder, GanttChartSquare, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type TFolder = { id: string; name: string; parent_id: string | null; sort_order: number; project_ids: string[] };

// transient drag source (a project id) — DnD is a same-frame gesture
let dragProjectId: string | null = null;

export const SidebarProjectFolders = observer(function SidebarProjectFolders() {
  const { workspaceSlug } = useParams();
  const router = useAppRouter();
  const { getProjectById, joinedProjectIds } = useProject();
  const service = useMemo(() => new ArribadaService(), []);
  const [folders, setFolders] = useState<TFolder[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);

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

  const createFolder = async () => {
    if (!ws) return;
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await service.createFolder(ws, name.trim());
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
    if (!ws || !window.confirm(`Delete folder "${f.name}"? Projects inside are not deleted.`)) return;
    await service.deleteFolder(ws, f.id);
    refetch();
  };
  const assign = async (projectId: string, folderId: string | null) => {
    if (!ws) return;
    setAddingTo(null);
    await service.assignProjectToFolder(ws, projectId, folderId);
    refetch();
  };

  if (folders.length === 0) {
    return (
      <button
        type="button"
        onClick={createFolder}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-11 text-placeholder hover:bg-layer-transparent-hover hover:text-secondary"
      >
        <FolderPlus className="size-3.5" />
        New project folder
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="group flex items-center justify-between px-2 py-1">
        <span className="text-11 font-semibold uppercase tracking-wide text-placeholder">Folders</span>
        <button type="button" onClick={createFolder} title="New folder" className="text-placeholder hover:text-secondary">
          <FolderPlus className="size-3.5" />
        </button>
      </div>
      {folders.map((f) => {
        const isOpen = open.has(f.id);
        return (
          <div key={f.id}>
            <div
              className="group flex items-center gap-1 rounded px-2 py-1 hover:bg-layer-transparent-hover"
              onDragOver={(e) => {
                if (dragProjectId) e.preventDefault();
              }}
              onDrop={() => {
                if (dragProjectId) assign(dragProjectId, f.id);
                dragProjectId = null;
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
                className="flex flex-grow items-center gap-1.5 text-left text-13 text-secondary"
              >
                {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <Folder className="size-3.5 text-tertiary" />
                <span className="truncate">{f.name}</span>
                <span className="text-11 text-placeholder">{f.project_ids.length}</span>
              </button>
              <div className="relative flex items-center opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => ws && router.push(`/${ws}/portfolio?folder=${f.id}`)}
                  title="Open this folder in the portfolio timeline"
                  className="text-placeholder hover:text-secondary"
                >
                  <GanttChartSquare className="size-3.5" />
                </button>
                <button type="button" onClick={() => setAddingTo(addingTo === f.id ? null : f.id)} title="Add project" className="ml-1 text-placeholder hover:text-secondary">
                  <Plus className="size-3.5" />
                </button>
                <button type="button" onClick={() => rename(f)} title="Rename" className="ml-1 text-placeholder hover:text-secondary">
                  <MoreHorizontal className="size-3.5" />
                </button>
                <button type="button" onClick={() => del(f)} title="Delete folder" className="ml-1 text-placeholder hover:text-danger-primary">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            {addingTo === f.id && (
              <div className="ml-6 mb-1 max-h-48 overflow-y-auto rounded border border-subtle bg-layer-1 p-1">
                {unassigned.length === 0 ? (
                  <div className="px-2 py-1 text-11 text-placeholder">All projects are already in a folder.</div>
                ) : (
                  unassigned.map((pid) => (
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
            )}

            {isOpen &&
              f.project_ids.map((pid) => (
                <div
                  key={pid}
                  draggable
                  onDragStart={() => {
                    dragProjectId = pid;
                  }}
                  className="group/item flex cursor-grab items-center gap-1 rounded py-0.5 pl-7 pr-2 hover:bg-layer-transparent-hover"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/${ws}/projects/${pid}/issues/`)}
                    className={cn("flex-grow truncate text-left text-13 text-secondary hover:text-primary")}
                  >
                    {getProjectById(pid)?.name ?? pid}
                  </button>
                  <button
                    type="button"
                    onClick={() => assign(pid, null)}
                    title="Remove from folder"
                    className="text-placeholder opacity-0 hover:text-danger-primary group-hover/item:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
});
