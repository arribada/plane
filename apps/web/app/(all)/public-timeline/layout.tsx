/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import type { Route } from "./+types/layout";

export const meta: Route.MetaFunction = () => [
  { title: "Project schedule" },
  // The anchor is unguessable, but that only holds while it stays out of an
  // index. A funder pasting the link somewhere crawlable would otherwise make a
  // page meant for one reader findable by search.
  { name: "robots", content: "noindex, nofollow" },
];

export default function PublicTimelineLayout() {
  return <Outlet />;
}
