# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The project link with the wiki's project template, both ways.

A project that follows the wiki's template has one code on both tools: the
Plane identifier (MARLIN, PETRL...) is the wiki's `projectCode`. Two flows keep
the pair in step:

- The wiki creates a project ("New project" on docs.arribada.org) and asks
  Plane, server to server, to create the Plane project or link an existing
  one: `WikiProjectsEndpoint`, authenticated by the secret both servers share.
- Someone on Plane presses "Create the wiki project": `ProjectWikiCreateEndpoint`
  asks the wiki to create the pages, under the mission the person picked from
  `ProjectWikiParentsEndpoint`, and stores the link it gets back.

Either way the link is `ProjectWikiDoc.doc_id` = the project's Overview page,
the row the Pages panel and the hub already read. Nothing here writes to a
project that is not named by the request, and the wiki never gets a session.
"""

import hmac
import json
import os
import re
from urllib import error as urlerror
from urllib import parse, request as urlrequest

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, State, User, Workspace, WorkspaceMember
from plane.db.models.state import DEFAULT_STATES

from .models import WIKI_WORKSPACE_ID, ProjectWikiDoc

PLANE_BASE = "https://plane.arribada.org"
WIKI_BASE_DEFAULT = "https://docs.arribada.org"
EXTERNAL_SOURCE = "arribada-wiki"
TIMEOUT_SECONDS = 30

# The wiki asks for letters only; Plane itself would also take digits.
CODE_PATTERN = re.compile(r"^[A-Z]{2,10}$")
NODE_ID_PATTERN = re.compile(r"^[a-z0-9]{20,64}$")


def _secret():
    return os.environ.get("WIKI_PROJECT_LINK_SECRET") or ""


def _secret_given(request):
    secret = _secret()
    given = request.headers.get("X-Wiki-Secret") or ""
    return bool(secret) and hmac.compare_digest(given.encode(), secret.encode())


class _AnonUnlessWikiSecret(AnonRateThrottle):
    """The anonymous rate (30 a minute) for anyone but the wiki server.

    Without a session every caller here is anonymous, so the wiki aligning
    28 projects ran into the limit a third of the way through: the list it
    reads first came back 429, the wiki took Plane for unreachable, and the
    projects it should have linked were left unlinked. A caller holding the
    256-bit secret is not throttled; a caller without it still is.
    """

    def allow_request(self, request, view):
        if _secret_given(request):
            return True
        return super().allow_request(request, view)


def _project_url(slug, project):
    return f"{PLANE_BASE}/{slug}/projects/{project.id}/issues"


def _payload(slug, project, doc_id):
    return {
        "project_id": str(project.id),
        "identifier": project.identifier,
        "name": project.name,
        "url": _project_url(slug, project),
        "wiki_node_id": doc_id or None,
        "archived": project.archived_at is not None,
    }


def _link(project, wiki_node_id, title):
    """Point the project at its wiki Overview, keeping every other link."""
    doc, _ = ProjectWikiDoc.objects.get_or_create(project=project)
    doc.workspace_id = WIKI_WORKSPACE_ID
    doc.doc_id = wiki_node_id
    if title:
        doc.title = title[:512]
    doc.save()
    return doc


class WikiProjectsEndpoint(BaseAPIView):
    """Called by the wiki server, never by a browser.

    GET lists every project of the workspace, archived ones included (their
    identifier is still taken), with the wiki page each one points to. POST
    creates a project for a wiki project (`mode: create`) or links the existing
    project with that identifier (`mode: link`).
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [_AnonUnlessWikiSecret]

    def _refusal(self, request):
        if not _secret():
            return Response({"error": "not_configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not _secret_given(request):
            return Response({"error": "unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
        return None

    def get(self, request, slug):
        refusal = self._refusal(request)
        if refusal:
            return refusal

        projects = list(Project.objects.filter(workspace__slug=slug).order_by("identifier"))
        docs = dict(
            ProjectWikiDoc.objects.filter(project__in=projects).values_list("project_id", "doc_id")
        )
        return Response({"projects": [_payload(slug, p, docs.get(p.id)) for p in projects]})

    def post(self, request, slug):
        refusal = self._refusal(request)
        if refusal:
            return refusal

        mode = request.data.get("mode")
        identifier = (request.data.get("identifier") or "").strip().upper()
        name = (request.data.get("name") or "").strip()
        wiki_node_id = (request.data.get("wiki_node_id") or "").strip()
        wiki_title = (request.data.get("wiki_title") or "").strip()
        actor_email = (request.data.get("actor_email") or "").strip().lower()

        if mode not in ("create", "link"):
            return Response({"error": "invalid_mode"}, status=status.HTTP_400_BAD_REQUEST)
        if not CODE_PATTERN.match(identifier):
            return Response({"error": "invalid_identifier"}, status=status.HTTP_400_BAD_REQUEST)
        if not NODE_ID_PATTERN.match(wiki_node_id):
            return Response({"error": "invalid_wiki_node_id"}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response({"error": "workspace_not_found"}, status=status.HTTP_404_NOT_FOUND)

        existing = Project.objects.filter(workspace=workspace, identifier=identifier).first()

        if mode == "link":
            if not existing:
                return Response({"error": "plane_project_not_found"}, status=status.HTTP_404_NOT_FOUND)
            doc = ProjectWikiDoc.objects.filter(project=existing).first()
            if doc and doc.doc_id and doc.doc_id != wiki_node_id:
                # Another wiki page already owns this project. Re-pointing it
                # silently would strand that page; a person decides.
                return Response({"error": "already_linked"}, status=status.HTTP_409_CONFLICT)
            _link(existing, wiki_node_id, wiki_title)
            return Response({"project": _payload(slug, existing, wiki_node_id)})

        if existing:
            return Response({"error": "identifier_taken"}, status=status.HTTP_409_CONFLICT)
        if not name:
            return Response({"error": "invalid_name"}, status=status.HTTP_400_BAD_REQUEST)

        # The project is created by the person who asked on the wiki, and only
        # if they may create projects here. There is no fallback author: a
        # project nobody on Plane can own is not one to make on their behalf.
        actor = None
        if actor_email:
            membership = (
                WorkspaceMember.objects.filter(
                    workspace=workspace,
                    member__email__iexact=actor_email,
                    is_active=True,
                    role__gte=ROLE.MEMBER.value,
                )
                .select_related("member")
                .first()
            )
            actor = membership.member if membership else None
        if actor is None:
            return Response({"error": "not_a_plane_member"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ProjectSerializer(
            data={
                "name": name,
                "identifier": identifier,
                "cycle_view": True,
                "module_view": True,
                "issue_views_view": True,
                "page_view": True,
                "external_source": EXTERNAL_SOURCE,
                "external_id": wiki_node_id,
            },
            context={"workspace_id": workspace.id},
        )
        if not serializer.is_valid():
            taken = any(key in serializer.errors for key in ("identifier", "name"))
            return Response(
                {"error": "identifier_taken" if taken else "invalid_project", "detail": serializer.errors},
                status=status.HTTP_409_CONFLICT if taken else status.HTTP_400_BAD_REQUEST,
            )

        try:
            # One transaction: a failure half-way must not leave a project that
            # holds the identifier with no states, which is what the public
            # API does when given a lead.
            with transaction.atomic():
                serializer.save()
                project = Project.objects.get(pk=serializer.data["id"])
                # No session here, so BaseModel.save() recorded no author;
                # the person who asked on the wiki is both author and lead.
                Project.objects.filter(pk=project.pk).update(created_by=actor, project_lead=actor)
                ProjectMember.objects.get_or_create(
                    project=project,
                    member=actor,
                    defaults={"role": ROLE.ADMIN.value, "workspace": workspace},
                )
                State.objects.bulk_create(
                    [
                        State(
                            name=state["name"],
                            color=state["color"],
                            project=project,
                            sequence=state["sequence"],
                            workspace=workspace,
                            group=state["group"],
                            default=state.get("default", False),
                            created_by=actor,
                        )
                        for state in DEFAULT_STATES
                    ]
                )
                _link(project, wiki_node_id, wiki_title)
        except IntegrityError:
            return Response({"error": "identifier_taken"}, status=status.HTTP_409_CONFLICT)

        project.refresh_from_db()
        return Response({"project": _payload(slug, project, wiki_node_id)}, status=status.HTTP_201_CREATED)


# --- Plane asking the wiki ----------------------------------------------------


class _RefuseRedirect(urlrequest.HTTPRedirectHandler):
    """A redirect would replay the secret to whatever host it names."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urlrequest.build_opener(_RefuseRedirect)


def _wiki_base():
    url = (os.environ.get("WIKI_BASE_URL") or WIKI_BASE_DEFAULT).rstrip("/")
    parts = parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme == "https" or (parts.scheme == "http" and host in ("localhost", "127.0.0.1", "::1")):
        return url
    raise ValueError("WIKI_BASE_URL must be https")


class WikiCallError(Exception):
    def __init__(self, status_code, code, message):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _wiki_call(method, path, body=None):
    """One request to the wiki's /client/v1/project-links routes."""
    secret = _secret()
    if not secret:
        raise WikiCallError(503, "not_configured", "The link with the wiki is not configured.")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(
        f"{_wiki_base()}/client/v1/project-links{path}",
        data=data,
        headers={"Content-Type": "application/json", "X-Project-Secret": secret},
        method=method,
    )
    try:
        with _opener.open(req, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8") or "null")
    except urlerror.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            detail = {}
        raise WikiCallError(
            exc.code,
            detail.get("code") or f"http_{exc.code}",
            detail.get("message") or "The wiki refused the request.",
        ) from exc
    except (urlerror.URLError, TimeoutError, ValueError) as exc:
        raise WikiCallError(502, "wiki_unreachable", "The wiki did not answer.") from exc


def _wiki_error(exc):
    status_code = exc.status_code if exc.status_code in (400, 403, 404, 409) else status.HTTP_502_BAD_GATEWAY
    return Response({"error": exc.code, "message": exc.message}, status=status_code)


class ProjectWikiParentsEndpoint(BaseAPIView):
    """The wiki missions and product lines a project's pages can go under."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="PROJECT")
    def get(self, request, slug, project_id):
        try:
            parents = _wiki_call("GET", "/parents")
        except WikiCallError as exc:
            return _wiki_error(exc)
        return Response({"parents": parents or []})


class ProjectWikiCreateEndpoint(BaseAPIView):
    """Create this project's pages on the wiki, from its template, and link them.

    Refused when the project already points to a wiki page: that page is the
    project's, and a second set would split its documentation in two.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="PROJECT")
    def post(self, request, slug, project_id):
        project = Project.objects.filter(workspace__slug=slug, pk=project_id).first()
        if not project:
            return Response({"error": "project_not_found"}, status=status.HTTP_404_NOT_FOUND)

        parent_id = (request.data.get("parent_id") or "").strip()
        if not NODE_ID_PATTERN.match(parent_id):
            return Response({"error": "invalid_parent"}, status=status.HTTP_400_BAD_REQUEST)
        if not CODE_PATTERN.match(project.identifier or ""):
            return Response(
                {
                    "error": "identifier_not_letters",
                    "message": "The wiki needs a project identifier of 2 to 10 capital letters.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        doc = ProjectWikiDoc.objects.filter(project=project).first()
        if doc and doc.doc_id:
            return Response({"error": "already_linked"}, status=status.HTTP_409_CONFLICT)

        try:
            created = _wiki_call(
                "POST",
                "/projects",
                {
                    "name": project.name,
                    "code": project.identifier,
                    "parent_id": parent_id,
                    "actor_email": getattr(request.user, "email", None),
                    "plane_project": {
                        "project_id": str(project.id),
                        "identifier": project.identifier,
                        "name": project.name,
                        "url": _project_url(slug, project),
                    },
                },
            )
        except WikiCallError as exc:
            return _wiki_error(exc)

        overview_id = (created or {}).get("overview_id") or ""
        if not NODE_ID_PATTERN.match(overview_id):
            return Response({"error": "wiki_bad_answer"}, status=status.HTTP_502_BAD_GATEWAY)

        _link(project, overview_id, f"{project.name} — Overview")
        return Response(
            {"wiki_node_id": overview_id, "wiki_url": (created or {}).get("url")},
            status=status.HTTP_201_CREATED,
        )
