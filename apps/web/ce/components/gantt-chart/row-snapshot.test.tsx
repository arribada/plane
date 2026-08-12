/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The three reports this file exists for, all of the same shape: the write lands,
 * the server is right, and the chart keeps drawing the old answer until a reload.
 *
 *   "je veux la drag and drop dans le sprint — ça fonctionne mais l'affichage ne
 *    s'actualise pas. Je quitte et je reviens et ça se met au bon endroit. Pareil
 *    quand je delete."
 *
 * `StaleChart` below is the shape `base-gantt-root.tsx` had: memos keyed on the id
 * array and on `getIssueById`. It is kept in the suite deliberately — it is the
 * proof that the identity of those two values does not change when their contents
 * do, and every assertion made against it is an assertion about the defect rather
 * than about the fix.
 *
 * The store is a miniature of the real one, but the two things that matter about it
 * are the real ones: `groupedIssueIds[ALL_ISSUES]` is a MobX observable array that a
 * delete splices in place (lodash `pull`, exactly as `base-issues.store.ts:1230`
 * does), and `getIssueById` is a `computedFn`. `buildGroups` and `flattenGroups`
 * are imported from the code that actually draws the bands.
 */
import { useMemo } from "react";
import { act, render, screen } from "@testing-library/react";
import { pull } from "lodash-es";
import { makeObservable, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import { computedFn } from "mobx-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { buildGroups, flattenGroups, groupKeyFromRowId, isGroupRowId } from "./grouping";
import type { TGanttGroupResolver } from "./grouping";
import { useRowSnapshot } from "./row-snapshot";

const ALL_ISSUES = "All Issues";

type TSeed = { id: string; name: string; cycle_id?: string | null; parent_id?: string | null };

class FakeIssueStore {
  issuesMap: Record<string, Partial<TIssue>> = {};
  groupedIssueIds: Record<string, string[]> = {};

  constructor(seeds: TSeed[]) {
    for (const seed of seeds) {
      this.issuesMap[seed.id] = {
        id: seed.id,
        name: seed.name,
        cycle_id: seed.cycle_id ?? null,
        parent_id: seed.parent_id ?? null,
        module_ids: [],
        label_ids: [],
        assignee_ids: [],
        state_id: null,
        priority: "none",
        start_date: null,
        target_date: null,
      };
    }
    this.groupedIssueIds[ALL_ISSUES] = seeds.map((seed) => seed.id);
    makeObservable(this, { issuesMap: observable, groupedIssueIds: observable });
  }

  getIssueById = computedFn((id: string): Partial<TIssue> | undefined => this.issuesMap[id]);
}

const CYCLES: Record<string, { name: string }> = { c1: { name: "Sprint 1" }, c2: { name: "Sprint 2" } };

const resolver = (store: FakeIssueStore): TGanttGroupResolver =>
  ({
    getIssue: (id: string) => store.getIssueById(id),
    getModule: () => null,
    getLabel: () => null,
    getMemberName: () => null,
    getState: () => null,
    getCycle: (id: string) => CYCLES[id] ?? null,
  }) as unknown as TGanttGroupResolver;

/** Renders the flattened rows the way the chart does: a band header, then its
 *  members. `data-row` carries the band each work item was drawn under. */
const Rows = ({ rowIds }: { rowIds: string[] }) => {
  let band = "";
  return (
    <ul>
      {rowIds.map((rowId) => {
        if (isGroupRowId(rowId)) {
          band = groupKeyFromRowId(rowId);
          return <li key={rowId} data-testid={`band-${band}`} />;
        }
        return <li key={rowId} data-testid={`row-${rowId}`} data-band={band} />;
      })}
      <li data-testid="count">{rowIds.filter((id) => !isGroupRowId(id)).length}</li>
    </ul>
  );
};

/** What `base-gantt-root.tsx` did: both memos keyed on values whose identity never
 *  changes. Kept as the reproduction. */
const StaleChart = observer(function StaleChart({ store }: { store: FakeIssueStore }) {
  const ids = store.groupedIssueIds[ALL_ISSUES];
  const getIssue = store.getIssueById;
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the defect, kept on purpose
  const groups = useMemo(() => buildGroups([...ids], "cycle", resolver(store)), [ids, getIssue, store]);
  const rowIds = useMemo(() => flattenGroups(groups, new Set<string>()), [groups]);
  return <Rows rowIds={rowIds} />;
});

/** The same pipeline reading the snapshot instead. */
const FreshChart = observer(function FreshChart({ store }: { store: FakeIssueStore }) {
  const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
  const groups = useMemo(() => buildGroups(rows, "cycle", resolver(store)), [rows, store]);
  const rowIds = useMemo(() => flattenGroups(groups, new Set<string>()), [groups]);
  return <Rows rowIds={rowIds} />;
});

const bandOf = (rowId: string) => screen.getByTestId(`row-${rowId}`).getAttribute("data-band");

/**
 * A stable number per array INSTANCE, so a test can assert "same identity" and
 * "new identity" without reaching into the hook. The point of the snapshot is that
 * its contents may be unchanged — the same three ids — while its identity is not,
 * which is exactly what a `useMemo` keyed on it needs.
 */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
const identityOf = (value: object): number => {
  const seen = identities.get(value);
  if (seen !== undefined) return seen;
  nextIdentity += 1;
  identities.set(value, nextIdentity);
  return nextIdentity;
};

let store: FakeIssueStore;

beforeEach(() => {
  store = new FakeIssueStore([
    { id: "i1", name: "Enclosure", cycle_id: "c1" },
    { id: "i2", name: "Firmware", cycle_id: null },
    { id: "i3", name: "Field trial", cycle_id: "c1" },
  ]);
});

describe("the two values the timeline's memos were keyed on", () => {
  it("keeps the same array identity when a delete removes a row", () => {
    const before = store.groupedIssueIds[ALL_ISSUES];
    runInAction(() => {
      pull(store.groupedIssueIds[ALL_ISSUES], "i1");
    });
    // Same object, two rows instead of three. This is the whole bug: `Object.is`
    // says nothing happened.
    expect(store.groupedIssueIds[ALL_ISSUES]).toBe(before);
    expect([...store.groupedIssueIds[ALL_ISSUES]]).toEqual(["i2", "i3"]);
  });

  it("keeps the same lookup identity when a work item joins a sprint", () => {
    const before = store.getIssueById;
    runInAction(() => {
      store.issuesMap.i2.cycle_id = "c1";
    });
    expect(store.getIssueById).toBe(before);
  });
});

describe("useRowSnapshot", () => {
  it("keeps its identity while nothing does", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    const { rerender } = render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    rerender(<Probe />);
    rerender(<Probe />);
    expect(screen.getByTestId("rev").textContent).toBe(first);
  });

  it("takes a new identity when a row leaves the in-place array", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    act(() => {
      runInAction(() => {
        pull(store.groupedIssueIds[ALL_ISSUES], "i1");
      });
    });
    expect(screen.getByTestId("rev").textContent).not.toBe(first);
  });

  it("takes a new identity when a field the bands are built from changes", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    act(() => {
      runInAction(() => {
        store.issuesMap.i2.cycle_id = "c2";
      });
    });
    expect(screen.getByTestId("rev").textContent).not.toBe(first);
  });

  it("takes a new identity when dates move, which is what the violation walk reads", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    act(() => {
      runInAction(() => {
        store.issuesMap.i1.start_date = "2026-09-01";
      });
    });
    expect(screen.getByTestId("rev").textContent).not.toBe(first);
  });

  it("takes a new identity when a parent is set, which is what sub-task nesting reads", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    act(() => {
      runInAction(() => {
        store.issuesMap.i3.parent_id = "i1";
      });
    });
    expect(screen.getByTestId("rev").textContent).not.toBe(first);
  });

  it("tells a work item the store has not loaded from one with no sprint", () => {
    const Probe = observer(function Probe() {
      const rows = useRowSnapshot(store.groupedIssueIds[ALL_ISSUES], store.getIssueById);
      return <span data-testid="rev">{identityOf(rows)}</span>;
    });
    render(<Probe />);
    const first = screen.getByTestId("rev").textContent;
    act(() => {
      runInAction(() => {
        delete store.issuesMap.i2;
      });
    });
    expect(screen.getByTestId("rev").textContent).not.toBe(first);
  });
});

describe("dropping a work item on a sprint band", () => {
  it("redraws the row under the sprint it was dropped on", () => {
    render(<FreshChart store={store} />);
    expect(bandOf("i2")).toBe("__unset__");

    act(() => {
      runInAction(() => {
        store.issuesMap.i2.cycle_id = "c1";
      });
    });

    expect(bandOf("i2")).toBe("c1");
    // It moved band, it did not get a second row.
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("was the reported defect: keyed on identity the row stays in the band it came from", () => {
    render(<StaleChart store={store} />);
    expect(bandOf("i2")).toBe("__unset__");

    act(() => {
      runInAction(() => {
        store.issuesMap.i2.cycle_id = "c1";
      });
    });

    expect(bandOf("i2")).toBe("__unset__");
  });

  it("follows a second move too", () => {
    render(<FreshChart store={store} />);
    act(() => {
      runInAction(() => {
        store.issuesMap.i2.cycle_id = "c1";
      });
    });
    act(() => {
      runInAction(() => {
        store.issuesMap.i2.cycle_id = "c2";
      });
    });
    expect(bandOf("i2")).toBe("c2");
  });

  it("moves the row out again when the sprint is cleared", () => {
    render(<FreshChart store={store} />);
    act(() => {
      runInAction(() => {
        store.issuesMap.i1.cycle_id = null;
      });
    });
    expect(bandOf("i1")).toBe("__unset__");
  });
});

describe("deleting a work item", () => {
  it("drops the row when the id is spliced out of the observable array", () => {
    render(<FreshChart store={store} />);
    expect(screen.getByTestId("row-i1")).toBeInTheDocument();

    act(() => {
      runInAction(() => {
        pull(store.groupedIssueIds[ALL_ISSUES], "i1");
        delete store.issuesMap.i1;
      });
    });

    expect(screen.queryByTestId("row-i1")).toBeNull();
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("was the reported defect: keyed on identity the deleted row stays on the chart", () => {
    render(<StaleChart store={store} />);
    act(() => {
      runInAction(() => {
        pull(store.groupedIssueIds[ALL_ISSUES], "i1");
        delete store.issuesMap.i1;
      });
    });
    expect(screen.queryByTestId("row-i1")).not.toBeNull();
  });

  it("empties the band when its last member goes", () => {
    render(<FreshChart store={store} />);
    act(() => {
      runInAction(() => {
        pull(store.groupedIssueIds[ALL_ISSUES], "i1");
        pull(store.groupedIssueIds[ALL_ISSUES], "i3");
        delete store.issuesMap.i1;
        delete store.issuesMap.i3;
      });
    });
    expect(screen.queryByTestId("band-c1")).toBeNull();
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});

describe("creating a work item", () => {
  it("draws the new row — this half already worked, and must keep working", () => {
    render(<FreshChart store={store} />);
    act(() => {
      runInAction(() => {
        store.issuesMap.i4 = {
          id: "i4",
          name: "Cast housing",
          cycle_id: "c2",
          module_ids: [],
          label_ids: [],
          assignee_ids: [],
          priority: "none",
        };
        // A create mints a NEW array, which is why this case was never broken.
        store.groupedIssueIds[ALL_ISSUES] = [...store.groupedIssueIds[ALL_ISSUES], "i4"];
      });
    });
    expect(bandOf("i4")).toBe("c2");
    expect(screen.getByTestId("count").textContent).toBe("4");
  });
});
