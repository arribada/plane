# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth routes, mounted on the ROOT URLconf rather than under /api/arribada/.

They have to live at the domain root because that is where a client looks: RFC
8414 derives the authorization-server metadata URL from the issuer, and RFC
9728 derives the protected-resource one from the resource. Both land on
`/.well-known/…`, and `/oauth/…` is named by the metadata we publish.

That also means the proxy in front of Django had to learn about them. Plane's
Caddy routes `/api/*`, `/auth/*` and `/static/*` to this service and everything
else to the frontend, so before the Caddyfile was extended these paths returned
the SPA's HTML with a 200 — a client asking for JSON got a web page, and the
error it then reported had nothing to do with the real cause. See ARRIBADA.md.

`re_path` for the two suffixed well-known forms: RFC 9728 inserts the resource's
path into the well-known URL, so a client may ask for
`/.well-known/oauth-protected-resource/api/arribada/mcp`. Different clients try
different ones; answering all of them costs four routes and removes a whole
class of "it does not discover".
"""

from django.urls import path, re_path

from .mcp_oauth_views import (
    authorization_server_metadata,
    authorize_get,
    authorize_post,
    protected_resource_metadata,
    register,
    token,
)


def authorize(request, *args, **kwargs):
    """One path, two methods.

    Django routes on the path alone, so `/oauth/authorize` needs a single view
    that picks the handler — the consent screen is a GET and the decision the
    form posts back is a POST to the same URL, which is what the `action` in
    the rendered form says. Splitting them across two `path()` entries does not
    work and fails as a 405 on the submit, after the user has already decided.

    The two halves keep their own decorators: GET-only and POST-only, so this
    dispatch cannot let a method through the wrong one.
    """
    if request.method == "POST":
        return authorize_post(request, *args, **kwargs)
    return authorize_get(request, *args, **kwargs)


urlpatterns = [
    path(
        ".well-known/oauth-protected-resource",
        protected_resource_metadata,
        name="arribada-oauth-protected-resource",
    ),
    re_path(
        r"^\.well-known/oauth-protected-resource/(?P<suffix>.*)$",
        protected_resource_metadata,
        name="arribada-oauth-protected-resource-suffixed",
    ),
    path(
        ".well-known/oauth-authorization-server",
        authorization_server_metadata,
        name="arribada-oauth-authorization-server",
    ),
    re_path(
        r"^\.well-known/oauth-authorization-server/(?P<suffix>.*)$",
        authorization_server_metadata,
        name="arribada-oauth-authorization-server-suffixed",
    ),
    path("oauth/register", register, name="arribada-oauth-register"),
    path("oauth/authorize", authorize, name="arribada-oauth-authorize"),
    path("oauth/token", token, name="arribada-oauth-token"),
    # Trailing-slash twins. Not decoration: a client that appends one otherwise
    # meets `plane.web.urls`' catch-all and is answered with the SPA, which is
    # the same silent wrong answer the `.well-known` paths used to give.
    path("oauth/register/", register),
    path("oauth/authorize/", authorize),
    path("oauth/token/", token),
]
