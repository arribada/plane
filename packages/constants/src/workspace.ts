/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStaticViewTypes, IWorkspaceSearchResults } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";

export const ORGANIZATION_SIZE: string[] = ["Just myself", "2-10", "11-50", "51-200", "201-500", "500+"];

export const RESTRICTED_URLS: string[] = [
  "404",
  "accounts",
  "api",
  "create-workspace",
  "god-mode",
  "installations",
  "invitations",
  "onboarding",
  "profile",
  "spaces",
  "workspace-invitations",
  "password",
  "flags",
  "monitor",
  "monitoring",
  "ingest",
  "plane-pro",
  "plane-ultimate",
  "enterprise",
  "plane-enterprise",
  "disco",
  "silo",
  "chat",
  "calendar",
  "drive",
  "channels",
  "upgrade",
  "billing",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "config",
  "live",
  "admin",
  "m",
  "import",
  "importers",
  "integrations",
  "integration",
  "configuration",
  "initiatives",
  "initiative",
  "config",
  "workflow",
  "workflows",
  "epics",
  "epic",
  "story",
  "mobile",
  "dashboard",
  "desktop",
  "onload",
  "real-time",
  "one",
  "pages",
  "mobile",
  "business",
  "pro",
  "settings",
  "monitor",
  "license",
  "licenses",
  "instances",
  "instance",
];

export const ROLE = {
  [EUserWorkspaceRoles.GUEST]: "Guest",
  [EUserWorkspaceRoles.MEMBER]: "Member",
  [EUserWorkspaceRoles.ADMIN]: "Admin",
};

export const ROLE_DETAILS = {
  [EUserWorkspaceRoles.GUEST]: {
    i18n_title: "role_details.guest.title",
    i18n_description: "role_details.guest.description",
  },
  [EUserWorkspaceRoles.MEMBER]: {
    i18n_title: "role_details.member.title",
    i18n_description: "role_details.member.description",
  },
  [EUserWorkspaceRoles.ADMIN]: {
    i18n_title: "role_details.admin.title",
    i18n_description: "role_details.admin.description",
  },
};

export const USER_ROLES = [
  {
    value: "Product / Project Manager",
    i18n_label: "user_roles.product_or_project_manager",
  },
  {
    value: "Development / Engineering",
    i18n_label: "user_roles.development_or_engineering",
  },
  {
    value: "Founder / Executive",
    i18n_label: "user_roles.founder_or_executive",
  },
  {
    value: "Freelancer / Consultant",
    i18n_label: "user_roles.freelancer_or_consultant",
  },
  { value: "Marketing / Growth", i18n_label: "user_roles.marketing_or_growth" },
  {
    value: "Sales / Business Development",
    i18n_label: "user_roles.sales_or_business_development",
  },
  {
    value: "Support / Operations",
    i18n_label: "user_roles.support_or_operations",
  },
  {
    value: "Student / Professor",
    i18n_label: "user_roles.student_or_professor",
  },
  { value: "Human Resources", i18n_label: "user_roles.human_resources" },
  { value: "Other", i18n_label: "user_roles.other" },
];

export const IMPORTERS_LIST = [
  {
    provider: "github",
    type: "import",
    i18n_title: "importer.github.title",
    i18n_description: "importer.github.description",
  },
  {
    provider: "jira",
    type: "import",
    i18n_title: "importer.jira.title",
    i18n_description: "importer.jira.description",
  },
];

export const EXPORTERS_LIST = [
  {
    provider: "csv",
    type: "export",
    i18n_title: "exporter.csv.title",
    i18n_description: "exporter.csv.description",
  },
  {
    provider: "xlsx",
    type: "export",
    i18n_title: "exporter.excel.title",
    i18n_description: "exporter.csv.description",
  },
  {
    provider: "json",
    type: "export",
    i18n_title: "exporter.json.title",
    i18n_description: "exporter.csv.description",
  },
];

export const DEFAULT_GLOBAL_VIEWS_LIST: {
  key: TStaticViewTypes;
  i18n_label: string;
}[] = [
  {
    key: "all-issues",
    i18n_label: "default_global_view.all_issues",
  },
  {
    key: "assigned",
    i18n_label: "default_global_view.assigned",
  },
  {
    key: "created",
    i18n_label: "default_global_view.created",
  },
  {
    key: "subscribed",
    i18n_label: "default_global_view.subscribed",
  },
];

export interface IWorkspaceSidebarNavigationItem {
  key: string;
  labelTranslationKey: string;
  /**
   * What to show when the catalogue has no entry for `labelTranslationKey`.
   * `t()` returns the KEY on a miss, so without this a typo or a key that never
   * got an entry renders as a lowercase slug in the sidebar — which is exactly
   * how "portfolio" and "workload" shipped. The project navigation has carried
   * the same field for the same reason since its own keys missed.
   */
  name?: string;
  href: string;
  access: EUserWorkspaceRoles[];
  highlight: (pathname: string, url: string) => boolean;
  /**
   * The entry opens a modal instead of navigating. `href` is then dead weight —
   * kept because the field is required and because a link that goes nowhere is
   * worse than one that is never rendered. The sidebar renders a button for
   * these, so no route needs to exist.
   */
  opensModal?: boolean;
}

export const WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS: Record<string, IWorkspaceSidebarNavigationItem> = {
  views: {
    key: "views",
    labelTranslationKey: "views",
    href: `/workspace-views/all-issues/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  analytics: {
    key: "analytics",
    labelTranslationKey: "analytics",
    href: `/analytics/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  archives: {
    key: "archives",
    labelTranslationKey: "archives",
    href: `/projects/archives/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
};

export const WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["views"],
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["analytics"],
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["archives"],
];

export const WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS: Record<string, IWorkspaceSidebarNavigationItem> = {
  home: {
    key: "home",
    labelTranslationKey: "home.title",
    href: `/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  inbox: {
    key: "inbox",
    labelTranslationKey: "notification.label",
    href: `/notifications/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  "your-work": {
    key: "your_work",
    labelTranslationKey: "your_work",
    href: `/profile/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  stickies: {
    key: "stickies",
    labelTranslationKey: "sidebar.stickies",
    href: `/stickies/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  drafts: {
    key: "drafts",
    labelTranslationKey: "drafts",
    href: `/drafts/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  projects: {
    key: "projects",
    labelTranslationKey: "projects",
    href: `/projects/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  portfolio: {
    key: "portfolio",
    labelTranslationKey: "sidebar.portfolio",
    name: "Portfolio",
    href: `/portfolio/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  github_triage: {
    key: "github_triage",
    // Was `labelTranslationKey: "GitHub triage"` — English smuggled through the
    // key so that `t()`'s miss-returns-the-key behaviour rendered something
    // readable. It worked and it could never be translated. `name` is now where
    // the fallback English lives, and the key is a key.
    labelTranslationKey: "sidebar.github_triage",
    name: "GitHub triage",
    href: `/github-triage/`,
    // Members and admins only: filing an issue into a project creates work
    // there, which a guest cannot do anywhere else either.
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  workload: {
    key: "workload",
    labelTranslationKey: "sidebar.workload",
    name: "Workload",
    href: `/workload/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  "request-expense": {
    key: "request_expense",
    // Same story as github_triage, same fix: a real key, with the English kept
    // as the fallback `name`.
    labelTranslationKey: "sidebar.request_expense",
    name: "Request an expense",
    // Never used — see `opensModal`. Kept non-empty so joinUrlPath cannot be
    // handed "" by some future caller that forgets the flag.
    href: `/projects/`,
    // POST /procurement/ is ADMIN or MEMBER; a guest would only get a 403 out
    // of the form, so it is not offered to them.
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: () => false,
    opensModal: true,
  },
};

export const WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["home"],
];

export const WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["projects"],
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["portfolio"],
  // Under Portfolio, where the user asked for it. This array is the one the
  // sidebar actually maps over — declaring the entry in the ITEMS record and
  // allow-listing its key in sidebar-item.tsx is necessary and does nothing on
  // its own, because nothing ever hands the component an item it does not
  // iterate. That is why the page shipped, was reachable by URL, and was
  // invisible in the panel.
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["github_triage"],
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["workload"],
];

/**
 * `request_expense` is deliberately NOT in the array above. That array feeds the
 * collapsible "Workspace" section, and Stickies does not live there — Stickies is
 * a personal-preference entry in the top group, assembled in
 * `sidebar-menu-items.tsx`. "Below Stickies" therefore means the top group, and
 * that file appends this entry after the personal items. The lesson from the two
 * entries that shipped invisible still stands: the record is a declaration, only
 * an array that something maps over puts a row on screen.
 */

export const IS_FAVORITE_MENU_OPEN = "is_favorite_menu_open";
export const WORKSPACE_DEFAULT_SEARCH_RESULT: IWorkspaceSearchResults = {
  results: {
    workspace: [],
    project: [],
    issue: [],
    cycle: [],
    module: [],
    issue_view: [],
    page: [],
  },
};

export const USE_CASES = [
  "Plan and track product roadmaps",
  "Manage engineering sprints",
  "Coordinate cross-functional projects",
  "Replace our current tool",
  "Just exploring",
];
