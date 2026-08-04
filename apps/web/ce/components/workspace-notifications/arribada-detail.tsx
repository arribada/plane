/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a notification says, and what you can do about it, in the pane beside it.
 *
 * Plane's notification pane peeks a work item and nothing else — it reads the id
 * out of `data.issue.id`, a field our own notifications do not carry. So every
 * notification this fork raises opened onto a blank panel: a bell that reports
 * things and then refuses to show them, which teaches people to stop clicking.
 *
 * This renders the parts we do store — the title, the body, the work item behind
 * it where there is one — and, for the daily "N unclassified GitHub tasks"
 * digest, the actual list with a project picker per row. The digest is the worst
 * of the lot: it carries no work item at all, so it could never have peeked
 * anything, and "18 unclassified tasks" with no way to reach them is a number
 * that only makes somebody feel behind.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { ExternalLink, Loader2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type TUnclassified = { id: string; name: string; sequence_id: number; repo: string | null };
type TProjectOption = { id: string; name: string };

type Props = {
  workspaceSlug: string;
  title: string;
  messageHtml?: string | null;
  /** Plane's own sender key, e.g. "in_app:github_triage_digest". */
  sender?: string | null;
  /** The work item the notification points at, when it points at one. */
  entityId?: string | null;
  projectId?: string | null;
};

export const ArribadaNotificationDetail = observer(function ArribadaNotificationDetail(props: Props) {
  const { workspaceSlug, title, messageHtml, sender, entityId, projectId } = props;
  const router = useAppRouter();
  const isDigest = (sender ?? "").includes("github_triage_digest");

  const [items, setItems] = useState<TUnclassified[] | null>(null);
  const [projects, setProjects] = useState<TProjectOption[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isDigest || !workspaceSlug) return;
    let live = true;
    setItems(null);
    const load = async () => {
      try {
        const data = await service.getGithubUnclassified(workspaceSlug);
        if (!live) return;
        setItems(data.items);
        setProjects(data.projects);
      } catch {
        if (live) setItems([]);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [isDigest, workspaceSlug]);

  const chosen = Object.entries(choice).filter(([, target]) => target);

  const classify = async () => {
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      // Adoption takes one target project per call, so the picks are grouped
      // rather than sent per row: eighteen tasks into three projects is three
      // requests, not eighteen.
      const byTarget = new Map<string, string[]>();
      for (const [issueId, target] of chosen) {
        byTarget.set(target, [...(byTarget.get(target) ?? []), issueId]);
      }
      const results = await Promise.all(
        [...byTarget].map(([target, ids]) =>
          service
            .adoptIssues(workspaceSlug, ids, target)
            // The endpoint reports how many it actually adopted, which can be
            // fewer than asked for; the request length would overstate it.
            .then((r) => (typeof r?.adopted === "number" ? r.adopted : ids.length))
        )
      );
      const moved = results.reduce((sum, n) => sum + n, 0);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${moved} filed`,
        message: "Each one now lives in its project, linked back to the inbox copy.",
      });
      setItems((current) => (current ?? []).filter((i) => !choice[i.id]));
      setChoice({});
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
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
      <h1 className="text-16 font-semibold text-primary">{title}</h1>

      {messageHtml && (
        // The body the notification was created with. Rendered rather than
        // dropped: it is often the only sentence explaining why this arrived.
        <div
          className="mt-2 text-13 text-secondary [&_b]:font-medium [&_b]:text-primary"
          // eslint-disable-next-line react/no-danger -- server-authored, from our own tasks
          dangerouslySetInnerHTML={{ __html: messageHtml }}
        />
      )}

      {entityId && projectId && (
        <button
          type="button"
          onClick={() => router.push(`/${workspaceSlug}/projects/${projectId}/issues/${entityId}/`)}
          className="mt-4 flex w-fit items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-12 text-secondary hover:text-primary"
        >
          <ExternalLink className="size-3.5" />
          Open the work item
        </button>
      )}

      {isDigest && (
        <section className="mt-5">
          <h2 className="mb-2 text-13 font-medium text-primary">File them into a project</h2>
          {items === null ? (
            <p className="text-13 text-tertiary">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-13 text-tertiary">
              Nothing is unclassified any more — everything in the inbox belongs to a project.
            </p>
          ) : (
            <>
              <p className="mb-3 text-12 text-tertiary">
                Picking a project copies the task there, links it back to the inbox item and closes the original — so
                the GitHub sync will not raise it again. Rows you leave blank stay where they are.
              </p>
              {/* The list is longer than the number in the title, and saying so
                  beats letting somebody wonder which figure is wrong. The digest
                  counts only tasks whose repo nobody claims; these also include
                  the ones several projects claim, which no sync can route and
                  only a person can settle. */}
              <p className="mb-3 text-11 text-tertiary">
                More than the digest counted: this also lists tasks whose repository several projects claim. The sync
                leaves those alone on purpose — filing them is a judgement call.
              </p>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-13 text-primary" title={item.name}>
                      {item.name}
                    </span>
                    <span className="flex-shrink-0 text-11 text-tertiary">{item.repo ?? "no repo found"}</span>
                    <select
                      value={choice[item.id] ?? ""}
                      onChange={(e) => setChoice((c) => ({ ...c, [item.id]: e.target.value }))}
                      aria-label={`Project for ${item.name}`}
                      className="w-52 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
                    >
                      <option value="">Leave in the inbox</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void classify()}
                  disabled={saving || chosen.length === 0}
                  className={cn(
                    "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
                    saving || chosen.length === 0 ? "opacity-50" : "hover:opacity-90"
                  )}
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  File {chosen.length}
                </button>
                <span className="text-11 text-tertiary">
                  {items.length} unclassified · {chosen.length} chosen
                </span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
});
