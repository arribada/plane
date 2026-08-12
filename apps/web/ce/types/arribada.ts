/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// One project row in the portfolio timeline. `start_date`/`target_date` are the
// human-entered plan; `derived_*` are computed by the API from the work items
// (MIN start / MAX target). The undated count is surfaced, never hidden.
export type TPortfolioProject = {
  id: string;
  name: string;
  identifier: string;
  logo_props: unknown;
  archived: boolean;
  start_date: string | null;
  target_date: string | null;
  derived_start_date: string | null;
  derived_target_date: string | null;
  item_count: number;
  scheduled_item_count: number;
  undated_item_count: number;
  completed_item_count: number;
  baseline_target_date: string | null;
  /** That project's plan is frozen (`ProjectSchedule.timeline_locked`), so its bar
   *  refuses a drag here exactly as it does on the project's own timeline.
   *  Optional: a backend that has not been redeployed yet must read as unlocked
   *  rather than as forbidden. */
  timeline_locked?: boolean;
};

// A person assigned to a work item, shown as an avatar on the timeline.
export type TItemAssignee = { id: string; name: string; avatar: string | null };

// A work item of a project, loaded lazily when its project row is expanded.
export type TPortfolioItem = {
  id: string;
  name: string;
  sequence_id: number;
  start_date: string | null;
  target_date: string | null;
  state_id: string | null;
  parent_id: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  assignees: TItemAssignee[];
  /** The axes the portfolio's subgrouping bands by. Optional because an older
   *  API — or the per-user timeline's payload — does not send them, and a missing
   *  field must read as "not in one" rather than crashing the band. `cycle` is
   *  Plane's field name; in this fork it is always a sprint. */
  cycle?: { id: string; name: string } | null;
  /** The lowest-named module the item is in. An item can be in several and can
   *  only be drawn on one row, so the server picks the same one the work-item
   *  timeline would. */
  module?: { id: string; name: string } | null;
  disciplines?: string[];
};

// One dated work item on somebody's personal timeline. It is a portfolio item that
// also names its project: a personal timeline spans every project at once, so the
// owner cannot be implied by the URL the way it is for a project's items.
export type TUserTimelineItem = TPortfolioItem & { project_id: string };

// The profile Timeline tab's payload. `undated_count` is the whole point of the
// envelope: items with no dates cannot be drawn, so they are counted and left out
// rather than quietly dropped, and `truncated` says when even the dated ones were cut.
export type TUserTimeline = {
  items: TUserTimelineItem[];
  total_count: number;
  undated_count: number;
  truncated: boolean;
};

// One of the requesting user's open assigned work items (Home 'My tasks' widget).
export type TMyWorkItem = {
  id: string;
  name: string;
  target_date: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  project_name: string;
};

// One place a project's files live. The label may be empty — every link migrated
// from the old single column has an empty one, because nobody was ever asked.
export type TDriveLink = {
  url: string;
  label: string;
};

// Where a project's documentation lives: a wiki doc, the Drive folders, the chat
// channel and the GitHub repos.
export type TProjectDocs = {
  doc_id: string | null;
  workspace_id: string | null;
  title: string | null;
  /** @deprecated A server-derived mirror of `google_drive_links[0].url`, kept so a
   *  client built before the list existed still shows a link. Read the list. */
  google_drive_url: string | null;
  google_drive_links: TDriveLink[];
  chat_url: string | null;
  github_repo_urls: string[];
};

// Someone on a project's roster, with the disciplines they cover. Plane's own
// ProjectMember.role is a permission level (admin/member/guest), never a job
// function, so the roster is a separate list that can also hold people who have
// no Plane account at all. `in_plane` = an account is linked; `assignable` = that
// account is an active member of this project and may receive work items.
export type TTeamMember = {
  id: string;
  member_id: string | null;
  name: string;
  email: string;
  roles: string[];
  is_lead: boolean;
  source: "manual" | "wiki";
  in_plane: boolean;
  assignable: boolean;
};

export type TProjectStatus = "on_track" | "at_risk" | "off_track";

// An Asana-style status post on a project.
export type TProjectStatusUpdate = {
  id: string;
  status: TProjectStatus;
  message: string;
  created_at: string;
  author: string | null;
};

export type TProjectSchedule = {
  /** Whether a reflow treats an expected delivery as a floor for the item waiting
   *  on it. Off unless the project asked: most projects have no hardware waiting
   *  on anything, and moving dates nobody opted into is how a planner loses trust. */
  schedule_from_deliveries?: boolean;
  /** What the project was given to spend. Null means nobody has said, which the
   *  budget view reports differently from zero. */
  budget_amount?: number | null;
  budget_currency?: string;
  /** A hard stop on moving anything from the timeline. Not a permission: the lead
   *  locks it too, because it says "this plan is agreed", not "you may not". */
  timeline_locked?: boolean;
  /** Whether a member may change a work item nobody assigned to them. */
  allow_edit_others?: boolean;
  /** Whether a member may add work items at all. */
  allow_add_items?: boolean;
  /** Whether only the lead may change the plan — dates, effort estimates,
   *  disciplines, parents, dependencies, sprint and module membership, and the
   *  planning tools. Unlike `timeline_locked` this IS a permission, so it does
   *  not apply to the lead or to a workspace admin. */
  lead_only_edits?: boolean;
  /** Whether THIS caller may change the plan — the server's own answer to
   *  `lead_only_edits`, so a control the client draws is one the server will
   *  serve. Never derive this from `lead_only_edits` and a roster call: two
   *  definitions of one permission drift, and the client's is the one that lies. */
  can_edit_plan?: boolean;
  /** Whether this caller may change WHO may change the plan. A different question
   *  from `can_edit_plan`, and a narrower answer: the governance switches are the
   *  lead's alone, where the plan itself also admits a workspace admin. */
  can_set_governance?: boolean;
  id: string;
  project: string;
  start_date: string | null;
  target_date: string | null;
};

// Everything the project Overview page renders, from one aggregate endpoint.
export type TProjectOverview = {
  project: {
    id: string;
    name: string;
    identifier: string;
    description: string | null;
    logo_props: unknown;
    cycle_view: boolean;
    module_view: boolean;
    issue_views_view: boolean;
    page_view: boolean;
  };
  schedule: { start_date: string | null; target_date: string | null };
  derived: { start_date: string | null; target_date: string | null };
  items: {
    total: number;
    completed: number;
    started: number;
    unstarted: number;
    backlog: number;
    cancelled: number;
    undated: number;
    overdue: number;
    due_week: number;
    unassigned: number;
  };
  cycles: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    total: number;
    completed: number;
    is_active: boolean;
    is_upcoming: boolean;
  }[];
  modules: {
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    target_date: string | null;
    total: number;
    completed: number;
  }[];
  pages: { count: number; recent: { id: string; name: string; updated_at: string }[] };
  links: {
    wiki_url: string | null;
    drive_url: string | null;
    chat_url: string | null;
    github_repo_urls: string[];
  };
  status: TProjectStatusUpdate | null;
  team: TTeamMember[];
  member_count: number;
  // How many roster entries still have no discipline set. Optional so an older
  // API, which never sends the key, still parses.
  roles_pending?: number;
  warnings: { code: string; message: string; severity: "info" | "warning" | "error" }[];
};

// Which LLM the planning assistant talks to. The key itself is write-only —
// the API only ever reports whether one is set and where it came from.
export type TAiSettings = {
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
  has_workspace_key: boolean;
  source: "workspace" | "environment" | "instance" | null;
  active_model: string | null;
  providers?: { value: string; label: string; default_model: string }[];
  default_provider?: string;
  provider_defaults?: Record<string, string>;
};

// One suggested placement for a work item: a window, and the person the
// assistant picked for it. `assignee_id` is null whenever nobody on the roster
// could take it (no Plane account, or not an assignable member of the project) —
// the row is still worth applying for its dates.
export type TPlanAssignment = {
  issue_id: string;
  name: string;
  sequence_id: number;
  start_date: string;
  target_date: string;
  reason: string;
  assignee_id: string | null;
  assignee_name: string | null;
  // The discipline the assistant matched the item to, null when it picked
  // someone without leaning on the roster's roles.
  role: string | null;
};

export type TAiPlan = {
  assignments: TPlanAssignment[];
  skipped: string[];
  notes: string;
  undated_count: number;
  // How many items were actually in scope: the selection when one was sent,
  // the undated items otherwise. Optional so an older API still parses.
  requested_count?: number;
  provider: string;
  model: string;
};

// ---------------------------------------------------------------------------
// Project setup: the generic V-cycle catalogue, and a plan built from it
// ---------------------------------------------------------------------------

// One generic task the wizard offers to create. `after` names the keys it waits
// on, which is what makes the proposed schedule a graph rather than a list.
export type TBlueprintTask = {
  key: string;
  name: string;
  phase: string;
  phase_label: string;
  role: string;
  days: number;
  optional: boolean;
  after: string[];
};

export type TBlueprintTrack = {
  key: string;
  label: string;
  hint: string;
  tasks: TBlueprintTask[];
};

// The blocks an agile project is built from. The per-sprint ceremonies are described
// once and repeated for every sprint, so ticking one applies to all of them.
export type TAgileCatalogue = {
  setup: { key: string; name: string; role: string; days: number }[];
  spikes: { key: string; name: string; role: string; days: number; track: string }[];
  ceremonies: { key: string; name: string; role: string; days: number; optional: boolean }[];
  closing: { key: string; name: string; role: string; days: number }[];
};

export type TBlueprintCatalogue = {
  tracks: TBlueprintTrack[];
  phases: { key: string; label: string }[];
  agile: TAgileCatalogue;
};

// A task once the scheduler has placed it: dates, the person its discipline
// resolves to today, and the sprint its start falls in.
export type TPlannedTask = {
  key: string;
  name: string;
  track: string;
  phase: string;
  role: string;
  days: number;
  after: string[];
  start_date: string;
  target_date: string;
  assignee_id: string | null;
  assignee_name: string | null;
  sprint: number | null;
  // True when the lead named this task's owner rather than letting the schedule
  // pick whoever holds the discipline.
  pinned?: boolean;
  // True when its dates were typed by hand. The schedule then works around them.
  date_pinned?: boolean;
  // Set on tasks the assistant added on top of the catalogue.
  added?: boolean;
  /** Working days this task can slip before any successor has to move. */
  free_float?: number | null;
  /** Working days it can slip before the project's end date moves. Zero means it
   *  is on the critical path — which is what `critical` restates. */
  total_float?: number | null;
  critical?: boolean;
};

/**
 * Why the critical path is what it is.
 *
 * An empty chain looks identical on the chart whatever the cause — nothing
 * dated, nothing linked, everything linked in a loop — and a chart that draws
 * nothing reads as a feature that does nothing. That is exactly how it was
 * reported. These counts are what the banner and the portfolio legend turn into
 * a sentence; `status` is an enum because the wording belongs on the screen that
 * knows whose screen it is, not in the API.
 */
export type TCriticalPathDiagnostics = {
  status: "ok" | "no_dependencies" | "dependencies_undated" | "cycles_only" | "no_dated_items";
  dated_count: number;
  undated_count: number;
  /** Sequencing links that exist at all. */
  relation_count: number;
  /** …and the ones both of whose ends are dated, so the chart can use them. */
  usable_relation_count: number;
  linked_count: number;
  cycle_count: number;
  critical_count: number;
};

// Someone the plan may hand a task to: a roster entry with a Plane account that
// the project would actually accept as an assignee.
export type TPlanPerson = {
  id: string;
  name: string;
  roles: string[];
};

export type TPlannedSprint = {
  index: number;
  name: string;
  start_date: string;
  end_date: string;
  task_count: number;
};

export type TSetupPlan = {
  start_date: string;
  end_date: string;
  tasks: TPlannedTask[];
  sprints: TPlannedSprint[];
  capacity: Record<string, number>;
  role_counts: Record<string, number>;
  // Who can be named on a task. The scheduler treats each of them as one pair of
  // hands, so somebody covering two disciplines queues their own work.
  people: TPlanPerson[];
  // Disciplines this plan needs that nobody on the roster holds. Not an error —
  // the requirement is recorded on the item and resolves when someone picks it up.
  missing_roles: string[];
  /** How many tasks have no slack at all. One line beats scanning a column. */
  critical_count?: number;
  warnings: string[];
  notes: string;
  provider: string | null;
  model: string | null;
};

export type TSetupApplyResult = {
  created: number;
  skipped: string[];
  relations: number;
  roles_set: number;
  assigned: number;
  modules_created: number;
  cycles_created: number;
};

// What the assistant proposes for a work item being written by hand. Every field
// lands in an editable form control — nothing here is written on its own.
export type TAiDraft = {
  description_html: string | null;
  role: string | null;
  days: number;
  start_date: string;
  target_date: string;
  assignee_id: string | null;
  assignee_name: string | null;
  reason: string;
  provider: string;
  model: string;
};

/**
 * What the portfolio's bars are coloured by.
 *
 * `project` and `priority` are the two this board shipped with. The rest are the
 * work-item timeline's own axes, in the work-item timeline's own words — `cycle`
 * stays Plane's field name and is spelled "Sprint" everywhere a reader can see
 * it. Sharing the vocabulary is the point: a board grouped by module and
 * coloured by module must not offer two different lists of modules.
 */
export type TPortfolioColorBy = "project" | "state" | "priority" | "assignee" | "cycle" | "module" | "discipline";
export type TPortfolioSortBy = "start_date" | "target_date" | "name" | "undated" | "manual";

// A raw dependency edge between two issues. relation_type is kept as a plain
// string on purpose — extending the global TIssueRelationTypes union would force
// every Record<TIssueRelationTypes,…> in the codebase to grow, so we don't.
export type TIssueRelationEdge = {
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
};

/** A captured GitHub issue nobody has filed yet — the inbox is the GithubIssue
 *  table, not a staging project, so `id` is that row and not a work item. */
export type TGithubInboxItem = {
  id: string;
  repo: string;
  number: number;
  title: string;
  html_url: string;
  labels: string[];
  state: string;
};

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** A day nobody works. Workspace-wide: a holiday is a fact about the calendar. */
export type TNonWorkingDay = { id: string; date: string; name: string };

export type TRoleRate = {
  role: string;
  hourly_rate: number;
  /** A working day is rarely eight hours, and a field day is not a bench day. */
  hours_per_day: number;
  currency: string;
};

/**
 * A market's indicative rates, served whole by the API. The numbers live only on
 * the server — the client renders what it is handed rather than keeping a second
 * copy that quietly drifts out of step with it.
 */
export type TRolePreset = {
  country: string;
  label: string;
  currency: string;
  hours_per_day: number;
  /** Keyed on the lowercased discipline, which is how a rate is stored. */
  rates: Record<string, number>;
  /** Where the figures came from. Shown, not hidden behind a tooltip. */
  source: string;
  captured_on: string;
};

/** The currency budgets are read in, and the one rate that gets them there. */
export type TCurrencySettings = {
  /** "" = read every project in its own currency and convert nothing. */
  display_currency: string;
  /** GBP per 1 EUR. Typed by a person, not fetched. */
  eur_gbp_rate: number;
  rate_captured_on: string | null;
  /** false when nobody has ever set this up. */
  configured: boolean;
  available: string[];
};

export type TExpenseCategory = "hardware" | "travel" | "field" | "services" | "shipping" | "other";

export type TProjectExpense = {
  id: string;
  category: TExpenseCategory;
  label: string;
  amount: number;
  quantity: number;
  /** amount x quantity, computed server-side so the two cannot disagree. */
  total: number;
  currency: string;
  /** true = budgeted, not yet spent. */
  planned: boolean;
  incurred_on: string | null;
  notes: string;
  /** Where it was bought. http(s) only — the server refuses anything else. */
  url: string;
  /** What a distributor's search box wants when this has to be reordered. */
  manufacturer_part_number: string;
  /** Who is supplying it. Carried through from a purchase request on approval. */
  supplier?: string;
  /** Calendar days the supplier quoted — their factory does not observe our
   *  weekends. A duration belonging to the work item, not a delivery date. */
  lead_time_days?: number | null;
  /** The work item this line belongs to. Null is the ordinary case. */
  issue_id?: string | null;
  issue_name?: string | null;
  issue_sequence_id?: number | null;
  /** True = this line IS that item's cost, so the item is not costed as our time
   *  anywhere: no person-days in the budget, no capacity booked against its
   *  owner. False on a line that sits BESIDE our labour — parts for a task we
   *  also spend days on. */
  replaces_labour?: boolean;
};

export type TMoney = { currency: string; amount: number };

/** One sprint's cost, or — with a null `cycle_id` — everything in no sprint. */
export type TCycleCost = {
  /** Null on the unsprinted row. There is no cycle to link to, so a client that
   *  routes on this cannot be made to route somewhere wrong. */
  cycle_id: string | null;
  name: string;
  start_date: string | null;
  end_date: string | null;
  /** Archived cycles are kept: money they consumed did not stop having been
   *  spent, and dropping them would reclassify their cost as unsprinted. */
  archived: boolean;
  /** Estimated from the plan. */
  labour: number;
  /** Recorded in the ledger, budgeted lines included — a sprint is a thing
   *  somebody commits to, so what it has committed belongs in its figure. */
  expense: number;
  amount: number;
  /** Work items in the sprint, not costed items: "9 items · nothing" is the
   *  reading that says those items carry no dates or no discipline. */
  items: number;
};

/**
 * The same figures read in one currency, as an approximation.
 *
 * A sibling of the blocks below and never a replacement for them: the recorded
 * amounts stay exactly as recorded, so a reader can always get back to the number
 * somebody actually typed. Only EUR and GBP convert; anything else is named in
 * `unconvertible` and left out of every total here.
 */
export type TBudgetDisplay = {
  currency: string;
  /** GBP per 1 EUR, and the day a human wrote it down. */
  rate: number;
  rate_captured_on: string | null;
  /** false when the rate is the built-in starting value, not one somebody set. */
  rate_configured: boolean;
  /** false when every figure was already in this currency — nothing to caveat. */
  converted: boolean;
  allocation: number | null;
  committed: number;
  remaining: number | null;
  percent: number | null;
  labour_total: number;
  expenses_planned: number;
  expenses_actual: number;
  unconvertible: string[];
};

/** One cumulative point on the spend curve. Both figures are in the curve's own
 *  currency, converted on the server at the rate a human recorded. */
export type TSpendCurvePoint = { date: string; committed: number; spent: number };

/** The spend curve, computed by `_spend_curve` on the server.
 *
 *  `committed` is human time plus every expense line; `spent` is only the lines
 *  marked paid. Labour is never `spent` — it is derived from a plan and there is
 *  no receipt behind it. Every omission is counted rather than dropped in
 *  silence, because a curve missing a third of the money is worse than one that
 *  says which third. */
export type TSpendCurve = {
  currency: string;
  points: TSpendCurvePoint[];
  /** The ceiling, or null — including when the allocation is in a currency these
   *  points are not, where drawing it would invite a comparison the data does not
   *  support. */
  allocation: number | null;
  /** Expenses with no date, which have no position on a time axis. */
  undated_expenses: number;
  /** Days carrying money outside the project's own window. The axis is widened
   *  to hold them rather than clipped — money that exists has to appear
   *  somewhere — and this says how far the plan is out. */
  outside_span: number;
  /** Currencies the EUR/GBP pair cannot reach, left out of every figure above. */
  unconvertible: string[];
  /** True when anything had to be converted, so the figures take a "≈". */
  converted: boolean;
};

export type TProjectBudget = {
  /** Approximate, single-currency view. The blocks below are the record. */
  display: TBudgetDisplay;
  /** The project's planned span, for anything drawn against time. */
  span: { start_date: string | null; target_date: string | null };
  /** Whether a reflow waits for expected deliveries. Off unless asked for. */
  schedule_from_deliveries: boolean;
  /** Monthly spend, the rate that still fits, and where the current one lands.
   *  Null on an older backend — the page must not assume it. */
  rhythm?: {
    /** `amount` is `labour + expense`. The two halves travel beside it rather
     *  than only summed: an estimate derived from a plan and a number with a
     *  receipt behind it are different kinds of fact, and a bar that blends them
     *  silently lends the estimate the receipt's authority. Both optional — an
     *  older server sends the sum alone. */
    months: { month: string; amount: number; labour?: number; expense?: number }[];
    rate: number | null;
    sustainable: number | null;
    months_left: number | null;
    exhausted_on: string | null;
    over_rate: boolean;
    /** The currency every figure in this block is in — the allocation's. Absent
     *  on an older server, where the client had to assume it. */
    currency?: string;
    /** Rates held in a currency this reading cannot convert, so their cost has
     *  no month. The days are still in `labour.by_role`. */
    unconvertible?: string[];
  } | null;
  /** What each sprint costs, and what falls outside every one of them.
   *
   *  A cycle is the unit a project manager commits to and reports on; a calendar
   *  month is an accounting artefact nobody plans in. Both halves are already
   *  converted into `currency`, because these rows are read against each other
   *  as bar lengths and two currencies have no comparable length. Absent on an
   *  older server. */
  by_cycle?: {
    cycles: TCycleCost[];
    currency: string;
    /** Currencies the EUR/GBP pair cannot reach, so this chart leaves them out.
     *  Their money is still in `expenses` and `labour`, as recorded. */
    unconvertible: string[];
  } | null;
  /** Cumulative committed and spent against the allocation, ready to draw.
   *
   *  Computed on the server because it has to convert across currencies and to
   *  include labour, and the client has neither the recorded EUR/GBP rate nor any
   *  labour figures. Absent on an older server. */
  curve?: TSpendCurve | null;
  /** The allocation and what is left of it. `amount` null = none recorded. */
  allocation: {
    amount: number | null;
    currency: string;
    committed: number;
    /** The currency `committed` is actually in. Equal to `currency` in every
     *  ordinary case, and different exactly when the allocation is held outside
     *  the EUR/GBP pair — there is then no way to express the total in it, so the
     *  server reports the total in a currency it can reach and says which.
     *  Absent on an older server. */
    committed_currency?: string;
    remaining: number | null;
    percent: number | null;
    /** True when `committed` could not be expressed in the allocation's own
     *  currency, so `remaining` and `percent` are withheld rather than computed
     *  across two bases. Absent on an older server. */
    basis_mismatch?: boolean;
    /** Currencies the EUR/GBP pair cannot reach, so `committed` leaves them out
     *  and says so. NOT "every currency but this one" — `committed` converts
     *  what it can, at the rate a human recorded, because a sum across
     *  currencies has only two possible policies and discarding is not the
     *  neutral one. */
    excluded_currencies: string[];
    /** True when some of `committed` was converted, so it should be shown with a
     *  "≈". False means every figure was already in this currency and the total
     *  is exact. Absent on an older server. */
    converted?: boolean;
  };
  /** Derived from the plan, so it moves whenever the plan does. */
  labour: {
    by_role: {
      role: string;
      days: number;
      hours: number;
      cost: number;
      currency: string | null;
      /** false when no rate is recorded — the days still count, so the gap shows. */
      rated: boolean;
    }[];
    totals: TMoney[];
    unrated_roles: string[];
    /** Work items left out because a supplier delivers them: their cost is an
     *  invoice in the ledger, not person-days here. A stated omission — a panel
     *  that just showed a smaller number would read as an estimate that shrank.
     *  Absent on an older server. */
    supplied_items?: number;
  };
  /** Entered by a person, and usually the only figure with a receipt behind it. */
  expenses: {
    /** A composition: every figure is read as a share of one total, so all of
     *  them are in ONE currency — the allocation's — converted where a line was
     *  entered in another. `currency` names that, and used to name whichever row
     *  happened to create the bucket. Lines the EUR/GBP pair cannot reach are
     *  left out, and are already named in `allocation.excluded_currencies`. */
    by_category: { category: TExpenseCategory; planned: number; actual: number; currency: string }[];
    /** True when anything above had to be converted to get there, so it should
     *  be shown with a "≈". Absent on an older server. */
    by_category_converted?: boolean;
    planned: TMoney[];
    actual: TMoney[];
    count: number;
    /** The subset that stands in for our time, so the page can show the two
     *  kinds apart. Adding them into one bar hides the only lever a manager has:
     *  you can move people, you cannot move a supplier's quote. */
    supplied?: { planned: TMoney[]; actual: TMoney[]; items: number };
  };
};

/**
 * A work item that is bought rather than done: a price, a supplier, a wait.
 *
 * The money is a line in the ordinary expense ledger — there is no second notion
 * of spend — and `replaces_labour` is what takes the item out of the labour
 * estimate and out of everybody's capacity. Read-only: the line is entered and
 * changed on the expense form, which is the only place money is entered at all.
 */
export type TIssueFixedCost = {
  /** Null when nothing has been recorded against this item. */
  expense_id: string | null;
  amount: number | null;
  quantity: number;
  total: number | null;
  currency: string;
  category: TExpenseCategory;
  /** true = committed, not yet paid. */
  planned: boolean;
  supplier: string;
  lead_time_days: number | null;
  replaces_labour: boolean;
  /** Where the quoted wait lands, from the item's start. Offered, never applied
   *  — and null once the item already has a target somebody decided. */
  suggested_target: string | null;
  /** Other lines on the sheet against this same item, which this panel does not
   *  show. Only present on a read. */
  other_lines?: number;
};

/** Somebody asking to spend the project's money. Inert until the lead approves. */
export type TProcurementRequest = {
  id: string;
  category: TExpenseCategory;
  label: string;
  amount: number;
  quantity: number;
  total: number;
  currency: string;
  supplier: string;
  justification: string;
  needed_by: string | null;
  /** Where it came from, and what a distributor's search box wants. Carried
   *  through to the expense line on approval — the requester is the one with
   *  the page open, so losing them at the yes meant nobody ever recorded them. */
  url?: string;
  manufacturer_part_number?: string;
  /** Calendar days the supplier quoted. */
  lead_time_days?: number | null;
  /** True = this purchase IS the linked work item's cost, so that item is not
   *  also costed as our time. Only meaningful with `issue_id`. */
  replaces_labour?: boolean;
  /** The purchasing record past the money decision. */
  order_reference?: string;
  ordered_on?: string | null;
  /** What the supplier promised — the date a schedule can be asked to respect. */
  expected_on?: string | null;
  /** What actually happened. Wins over expected_on once set. */
  received_on?: string | null;
  /** The work item this delivery unblocks; null for the ordinary consumable. */
  issue_id?: string | null;
  // ordered/received extend the record past the money decision: approving says
  // the budget is committed, not that the parts have landed.
  status: "pending" | "approved" | "rejected" | "ordered" | "received";
  requested_by: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  /** The expense line approval produced, so the two can never drift. */
  expense_id: string | null;
  created_at: string;
};

/** A live, no-login link to one project's schedule. */
export type TPublicTimelineLink = {
  anchor: string;
  created_at: string;
  created_by_name: string | null;
};

export type TPublicTimelineState = {
  link: TPublicTimelineLink | null;
  may_publish: boolean;
  /** How many bars would go out, so the dialog can say so before publishing. */
  item_count: number;
};

export type TWorkspacePublicTimeline = TPublicTimelineLink & {
  project_id: string;
  project_name: string;
};

/** What a reader with no account gets. Note what is NOT here. */
export type TPublicTimeline = {
  project: { name: string; start_date: string | null; target_date: string | null };
  items: {
    name: string;
    start_date: string | null;
    target_date: string | null;
    state_group: string | null;
    milestone: { kind: "gate" | "delivery" | "review" } | null;
  }[];
};

/** Work in person-days, plus the span it implies when a date is missing. */
export type TIssueEffort = {
  days: number | null;
  /** What it actually took, asked for when the item is finished. Kept beside the
   *  estimate rather than replacing it, so the project can still tell how good
   *  its estimates were. */
  actual_days?: number | null;
  /** What the dates imply: working days x assignees. Null once an effort is
   *  recorded — there is nothing left to derive. */
  derived?: number | null;
  /** Offered, never applied — the server does not move dates. */
  suggested_dates: { start_date: string; target_date: string } | null;
};
