/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { layout, route } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";

export const extendedRoutes: RouteConfigEntry[] = [
  // A project's schedule, readable with no account. Registered here rather than
  // in core.ts so the upstream route table stays untouched, and nested under its
  // own layout so it inherits no authentication wrapper — the sign-up wrapper
  // redirects users who ARE signed in, which would bounce the project lead away
  // from the page they just published.
  //
  // The path falls through Caddy's catch-all to the web app, whose nginx
  // `try_files … /index.html` hands it back to this router.
  layout("./(all)/public-timeline/layout.tsx", [route("public/timeline/:anchor", "./(all)/public-timeline/page.tsx")]),
];
