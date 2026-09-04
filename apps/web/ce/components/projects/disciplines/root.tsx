/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A read-only "who is doing what" view of a project: its work items grouped and
 * coloured by DISCIPLINE. The gantt already colours bars by discipline; this is
 * the same idea for people who want the picture as a list rather than a timeline
 * — a first-time, non-technical reader can see at a glance how the work splits
 * across hardware / firmware / software / field ops. It reuses the gantt's own
 * six-hue palette so a discipline is the same colour on both screens.
 */
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Link } from "react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import { useProject } from "@/hooks/store/use-project";
import { buildColorScale, isDarkSurface, type TColorSample } from "@/plane-web/components/gantt-chart/palette";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioItem } from "@/plane-web/types/arribada";

const arribadaService = new ArribadaService();

const NO_DISCIPLINE = "__none__";

/** A work item's discipline, or the sentinel for "nobody has assigned one". */
const disciplineOf = (item: TPortfolioItem): string => item.disciplines?.[0] || NO_DISCIPLINE;

const ProjectDisciplinesRoot = observer(function ProjectDisciplinesRoot() {
  const { workspaceSlug, projectId } = useParams();
  const { getProjectById } = useProject();

  const slug = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const project = pid ? getProjectById(pid) : undefined;

  // null = not loaded yet; an array (even empty) = a real answer from the server.
  // The distinction matters: "no items" and "the request failed" must not read as
  // the same empty screen, which is the whole point of the error branch below.
  const [items, setItems] = useState<TPortfolioItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!slug || !pid) return;
    let alive = true;
    setItems(null);
    setError(null);
    arribadaService
      .getProjectItems(slug, pid)
      .then((rows) => {
        if (alive) setItems(rows ?? []);
      })
      .catch(() => {
        if (alive) setError("Couldn't load this project's work items. Check your connection and try again.");
      });
    return () => {
      alive = false;
    };
  }, [slug, pid, reloadKey]);

  const dark = isDarkSurface();

  // The colour scale is computed over EVERY item so a discipline keeps its hue
  // whatever subset is on screen — the same rule the gantt's scale follows.
  const { groups, scale, total } = useMemo(() => {
    const rows = items ?? [];
    const samples: TColorSample[] = rows.map((item) => {
      const key = disciplineOf(item);
      return { key: key === NO_DISCIPLINE ? null : key, label: key };
    });
    const built = buildColorScale(samples, { dark, unsetLabel: "No discipline" });

    const byKey = new Map<string, TPortfolioItem[]>();
    for (const item of rows) {
      const key = disciplineOf(item);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(item);
      else byKey.set(key, [item]);
    }
    // Order the sections the way the legend is ordered (frequency, then name),
    // with "No discipline" always last.
    const ordered = built.entries
      .map((entry) => ({
        entry,
        key: entry.unset ? NO_DISCIPLINE : entry.key,
        items: byKey.get(entry.unset ? NO_DISCIPLINE : entry.key) ?? [],
      }))
      .filter((g) => g.items.length > 0);

    return { groups: ordered, scale: built, total: rows.length };
  }, [items, dark]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-8 text-danger-text" />
        <p className="max-w-sm text-13 text-secondary">{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded border border-subtle px-3 py-1.5 text-13 text-primary hover:bg-layer-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8 text-tertiary">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-13">Loading work items…</span>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-13 text-secondary">No work items yet.</p>
        <p className="max-w-sm text-12 text-tertiary">
          Add work items and give each a discipline, and they will appear here grouped by who does the work.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      {/* A legend that doubles as a summary: every discipline present, with its
          share of the work, so the split is readable before scrolling. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {groups.map(({ entry, key }) => (
          <div key={key} className="flex items-center gap-1.5 text-12 text-secondary">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: scale.colorOf(entry.unset ? null : key) }} />
            <span className="text-primary">{entry.label}</span>
            <span className="text-tertiary">
              {entry.count} · {Math.round((entry.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>

      {groups.map(({ entry, key, items: rows }) => {
        const color = scale.colorOf(entry.unset ? null : key);
        return (
          <section key={key} className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
            <header
              className="flex items-center gap-2 border-b border-subtle px-3 py-2"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
              <h3 className="text-13 font-medium text-primary">{entry.label}</h3>
              <span className="text-12 text-tertiary">{rows.length}</span>
            </header>
            <ul>
              {rows.map((item) => (
                <li key={item.id} className="border-b border-subtle last:border-0">
                  <Link
                    to={`/${slug}/projects/${pid}/issues/${item.id}`}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-layer-2"
                  >
                    {project?.identifier && (
                      <span className="shrink-0 font-mono text-11 text-tertiary">
                        {project.identifier}-{item.sequence_id}
                      </span>
                    )}
                    <span className="flex-grow truncate text-13 text-primary">{item.name}</span>
                    {item.target_date && (
                      <span className="shrink-0 text-11 text-tertiary">{item.target_date}</span>
                    )}
                    <span className="flex shrink-0 -space-x-1.5">
                      {item.assignees.slice(0, 4).map((a) =>
                        a.avatar ? (
                          <img
                            key={a.id}
                            src={a.avatar}
                            alt={a.name}
                            title={a.name}
                            className="size-5 rounded-full border border-layer-1 object-cover"
                          />
                        ) : (
                          <span
                            key={a.id}
                            title={a.name}
                            className="flex size-5 items-center justify-center rounded-full border border-layer-1 bg-layer-3 text-9 uppercase text-secondary"
                          >
                            {a.name?.charAt(0) || "?"}
                          </span>
                        )
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
});

export { ProjectDisciplinesRoot };
