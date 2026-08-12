/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Sub-task nesting for the gantt. A work item that has a parent is drawn UNDER
 * that parent behind a chevron, instead of taking a top-level row of its own
 * beside it — so a plan with forty items and thirty sub-tasks reads as ten.
 *
 * "Sub-task" here is Plane's own `parent` relation and nothing else. The fork's
 * checklist is deliberately NOT a parent link — a checklist line is a tick on one
 * work item, not a work item — so nothing in this file can fold one away, and
 * nothing here should ever be taught to.
 *
 * Every function is pure and takes the list it works on. That is what makes the
 * composition with grouping expressible: bands are computed first and keep their
 * meaning (a band holds exactly the items with that field value), then nesting is
 * applied INSIDE each band. A sub-task whose parent sits in another band — or in
 * another project, on the portfolio — is not nested; it keeps a row of its own,
 * because the alternative is a header that promises "Hardware" and holds a
 * firmware task, or a chevron pointing at a row that is not on screen.
 */
import type { TGanttGroup } from "./grouping";

/** What nesting needs of a work item. Deliberately narrower than TIssue so a test
 *  can hand over three fields instead of building a whole issue. */
export type TSubtaskIssue = {
  parent_id?: string | null;
  start_date?: string | null;
  target_date?: string | null;
};

export type TSubtaskLookup = (id: string) => TSubtaskIssue | undefined | null;

export type TSubtaskNode = {
  id: string;
  /** The parent WITHIN THIS LIST, or null. Not the same as the work item's
   *  `parent_id`: a parent that is filtered out, on another page, or in another
   *  band is not a parent here. */
  parentId: string | null;
  depth: number;
  childIds: string[];
  /** Every descendant present in the same list, at any depth. */
  descendants: number;
};

export type TSubtaskTree = {
  /** The same ids, reordered so each parent is immediately followed by its
   *  subtree. Roots keep the order they arrived in, and so do siblings. */
  order: string[];
  byId: Map<string, TSubtaskNode>;
};

export const EMPTY_SUBTASK_TREE: TSubtaskTree = { order: [], byId: new Map() };

/** Every row that is not a child of something shares this key, so they can be
 *  reordered against each other while a child cannot be dropped among them. */
export const ROOT_DRAG_SCOPE = "__root__";

/**
 * Nest a flat id list.
 *
 * Depth is unbounded — Plane allows a parent chain, and stopping at one level
 * would draw a grandchild as a top-level row directly beneath its own parent's
 * subtree, which reads as a sibling of the thing it belongs to. Nesting N levels
 * costs one extra walk and is the only depth that is never a lie.
 */
export const buildSubtaskTree = (ids: string[], getIssue: TSubtaskLookup): TSubtaskTree => {
  if (ids.length === 0) return { order: [], byId: new Map() };

  const present = new Set(ids);
  const parentOf = new Map<string, string | null>();
  for (const id of ids) {
    const raw = getIssue(id)?.parent_id ?? null;
    parentOf.set(id, raw && raw !== id && present.has(raw) ? raw : null);
  }

  // Break cycles before walking. `parent_id` is a database edge and nothing in
  // the schema stops A→B→A after a bad import or a merge; a cycle would make the
  // walk below recurse until the stack gives out, which is a blank screen rather
  // than a wrong one. Every member of a cycle detects it on its own pass, so the
  // result is deterministic: the cycle is cut, and its members become roots in
  // the order they appear.
  for (const id of ids) {
    const seen = new Set<string>([id]);
    let cursor = parentOf.get(id) ?? null;
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.set(id, null);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const childIds = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of ids) {
    const parent = parentOf.get(id) ?? null;
    if (!parent) {
      roots.push(id);
      continue;
    }
    const siblings = childIds.get(parent);
    if (siblings) siblings.push(id);
    else childIds.set(parent, [id]);
  }

  const byId = new Map<string, TSubtaskNode>();
  const order: string[] = [];
  const walk = (id: string, depth: number): number => {
    // A duplicate id would give one work item two bars and two rows, and every
    // dependency arrow looks a row up by id. Keep the first.
    if (byId.has(id)) return 0;
    const kids = childIds.get(id) ?? [];
    const node: TSubtaskNode = { id, parentId: parentOf.get(id) ?? null, depth, childIds: kids, descendants: 0 };
    byId.set(id, node);
    order.push(id);
    let total = 0;
    for (const kid of kids) total += 1 + walk(kid, depth + 1);
    node.descendants = total;
    return total;
  };
  for (const root of roots) walk(root, 0);

  return { order, byId };
};

/**
 * Nesting applied inside each band, with one tree covering the lot.
 *
 * The bands are not recomputed: `buildGroups` has already decided what belongs
 * where, and this only reorders each band's members and records who is under
 * whom. A parent in another band is therefore not a parent here — see the file
 * header for why that is the honest answer rather than the tidy one.
 */
export const nestGroups = (
  groups: TGanttGroup[],
  getIssue: TSubtaskLookup
): { groups: TGanttGroup[]; tree: TSubtaskTree } => {
  const byId = new Map<string, TSubtaskNode>();
  const nested = groups.map((group) => {
    const tree = buildSubtaskTree(group.ids, getIssue);
    for (const [id, node] of tree.byId) byId.set(id, node);
    return { ...group, ids: tree.order };
  });
  return { groups: nested, tree: { order: nested.flatMap((group) => group.ids), byId } };
};

/**
 * Drop the rows hidden behind a folded parent.
 *
 * Runs LAST, over the id list both panes are about to render — group headers
 * included, which is why it filters by ancestry rather than rebuilding a list: a
 * synthetic header id is in no tree, so it has no collapsed ancestor and survives
 * untouched.
 */
export const hideCollapsedDescendants = (
  rowIds: string[],
  tree: TSubtaskTree,
  collapsed: ReadonlySet<string>
): string[] => {
  if (collapsed.size === 0) return rowIds;
  return rowIds.filter((id) => {
    let cursor = tree.byId.get(id)?.parentId ?? null;
    while (cursor) {
      if (collapsed.has(cursor)) return false;
      cursor = tree.byId.get(cursor)?.parentId ?? null;
    }
    return true;
  });
};

/** Every id in the tree that has at least one child — what "collapse all" folds. */
export const parentIds = (tree: TSubtaskTree): string[] =>
  tree.order.filter((id) => (tree.byId.get(id)?.childIds.length ?? 0) > 0);

/**
 * The span a folded parent's descendants cover.
 *
 * The parent's own bar never changes — see the decision recorded in the toolbar
 * component: the bar you drag has to be the bar you see, and re-spanning it to
 * the children's envelope would mean dragging a summary with no defined effect.
 * So the envelope is drawn separately, behind the bar, and only while the
 * children are folded away. `null` when the descendants add nothing outside the
 * parent's own dates, so nothing is drawn for the ordinary case where a parent
 * already spans its children.
 */
export const subtaskRollup = (
  id: string,
  tree: TSubtaskTree,
  getIssue: TSubtaskLookup
): { start: Date; end: Date } | null => {
  const node = tree.byId.get(id);
  if (!node || node.childIds.length === 0) return null;

  let first: number | null = null;
  let last: number | null = null;
  const stack = [...node.childIds];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    const child = tree.byId.get(next);
    if (child) stack.push(...child.childIds);
    const issue = getIssue(next);
    for (const value of [issue?.start_date, issue?.target_date]) {
      if (!value) continue;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) continue;
      if (first === null || time < first) first = time;
      if (last === null || time > last) last = time;
    }
  }
  if (first === null || last === null) return null;

  const own = getIssue(id);
  const ownStart = own?.start_date ? new Date(own.start_date).getTime() : null;
  const ownEnd = own?.target_date ? new Date(own.target_date).getTime() : null;
  const insideOwnBar =
    ownStart !== null && ownEnd !== null && !Number.isNaN(ownStart) && !Number.isNaN(ownEnd)
      ? first >= ownStart && last <= ownEnd
      : false;
  if (insideOwnBar) return null;

  return { start: new Date(first), end: new Date(last) };
};
