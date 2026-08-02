/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The sidebar's edition badge — deliberately renders nothing.
 *
 * Upstream puts a "Community" button here that opens a modal offering to buy a
 * paid Plane plan. On a self-hosted fork that advertises a product nobody in this
 * workspace can act on, from the sidebar of every page, under a name that is not
 * this product's.
 *
 * The component is kept rather than deleted: apps/web/core imports it by path
 * (sidebar-wrapper.tsx), so returning null keeps the change inside the fork's own
 * ce/ tree. Removing the import would touch a file this fork otherwise leaves
 * alone, and the next upstream merge would put it straight back.
 */
export function WorkspaceEditionBadge() {
  return null;
}
