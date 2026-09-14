# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The MCP endpoint: JSON-RPC 2.0 over one HTTP POST.

`POST /api/arribada/mcp/`, which is the Model Context Protocol's Streamable HTTP
transport with the streaming half declined. The spec permits a server to answer a
POST with a single `application/json` response instead of an SSE stream, and every
tool here answers in one shot from one database round trip — there is nothing to
stream, and an SSE channel would be a long-lived connection through the Caddy
proxy for no gain.

`GET` and `DELETE` therefore answer 405, which is exactly what the spec says a
server that does not offer a server-initiated stream should do; a client reads
that and stops asking rather than treating it as an error.

WHAT THIS LAYER IS RESPONSIBLE FOR, and the list is deliberately short:
transport framing, protocol version negotiation, rate limiting, and turning a
`ToolError` into an `isError` result rather than an HTTP failure. Every
permission question belongs to `mcp_tools.call_tool` and, through it, to the
fork's own endpoints.

WHY A TOOL FAILURE IS AN HTTP 200. An MCP client reads a transport error as "the
server is gone" and a JSON-RPC error as "the protocol broke" — both of which end
the conversation. A refused tool call is neither: it is a result the model should
read, reason about and act on ("this token cannot read finance; ask for one that
can"). So refusals come back as `isError: true` inside a successful response, and
only a malformed envelope gets a JSON-RPC error.
"""

import json
import time

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .mcp_auth import MCPTokenAuthentication
from .mcp_tools import ToolError, call_tool, json_default, list_tools

SERVER_NAME = "arribada-plane"

# Bumped when the TOOL SURFACE changes in a way an agent could notice — a tool
# added, removed, renamed, or its arguments changed. Not the deploy version:
# this is the only version an MCP client ever sees, and tying it to the image tag
# would make it change on every unrelated backend build.
SERVER_VERSION = "1.0.0"

# Newest first. The client names what it wants in `initialize`; if we know that
# version we echo it back, and if we do not we answer with our newest and let the
# client decide whether it can live with it — which is what the spec prescribes,
# and is friendlier than refusing a client that is merely newer than us.
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")

# Per token. Generous for a person driving an agent, low enough that a runaway
# loop hits a wall before it walks the whole workspace: the read tools are the
# same queries the web app makes, and this instance serves ten people.
RATE_LIMIT_CALLS = 120
RATE_LIMIT_WINDOW = 60


def _rate_limited(token):
    """A fixed window in the cache, per token.

    FAILS OPEN, and that is a decision rather than an oversight. This fork sets
    `IGNORE_EXCEPTIONS` on the cache precisely so a Valkey blip cannot 500 a
    request that Postgres could have served, so a cache outage here returns None
    and the limiter stops limiting. The thing it protects against is a runaway
    agent, not an adversary — an adversary needs a live token first, and a live
    token is revocable. Trading the limiter for availability during a cache
    outage is the right way round for that threat.
    """
    from django.core.cache import cache

    key = f"mcp-rate:{token.id}:{int(time.time() // RATE_LIMIT_WINDOW)}"
    try:
        count = cache.get_or_set(key, 0, RATE_LIMIT_WINDOW)
        count = cache.incr(key)
    except Exception:  # noqa: BLE001
        return False
    return count is not None and count > RATE_LIMIT_CALLS


def _result(request_id, payload):
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def _error(request_id, code, message):
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _text_result(payload, is_error=False):
    """A tool result. MCP carries content as blocks; JSON in a text block is what
    every client renders and what a model reads best."""
    text = payload if isinstance(payload, str) else json.dumps(payload, indent=2, default=json_default)
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


class MCPEndpoint(APIView):
    """One POST, one JSON-RPC message, one response.

    `authentication_classes` is ONLY the MCP token class. Adding the session
    class beside it would mean a signed-in browser tab could drive this endpoint
    with no token and therefore no scope, no project allow-list, no money gate
    and no audit row — every control in this subsystem bypassed by being logged
    in. The web app has its own endpoints; this one has exactly one way in.
    """

    authentication_classes = [MCPTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "error": "This MCP server does not offer a server-initiated stream. POST JSON-RPC here.",
                "server": SERVER_NAME,
                "version": SERVER_VERSION,
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def delete(self, request):
        return Response(
            {"error": "This MCP server is stateless; there is no session to end."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def post(self, request):
        token = request.auth
        if token is None:
            # Authentication succeeded some other way, which it cannot — but an
            # assertion that costs one comparison is cheaper than the class of
            # bug where `request.auth` is quietly None and every grant check
            # reads as permissive.
            return Response({"error": "MCP token required."}, status=status.HTTP_401_UNAUTHORIZED)

        body = request.data
        if isinstance(body, list):
            return Response(
                _error(None, -32600, "Batched requests are not supported; send one message per POST."),
                status=status.HTTP_200_OK,
            )
        if not isinstance(body, dict):
            return Response(_error(None, -32700, "Expected a JSON-RPC object."), status=status.HTTP_200_OK)

        method = body.get("method")
        request_id = body.get("id")
        params = body.get("params") if isinstance(body.get("params"), dict) else {}

        # A notification has no id and takes no response. `notifications/
        # initialized` is the one every client sends straight after initialize;
        # answering it with a body makes some clients log a protocol violation.
        if request_id is None and isinstance(method, str) and method.startswith("notifications/"):
            return Response(status=status.HTTP_202_ACCEPTED)

        if method == "initialize":
            wanted = params.get("protocolVersion")
            version = wanted if wanted in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0]
            return Response(
                _result(
                    request_id,
                    {
                        "protocolVersion": version,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                        "instructions": (
                            "Arribada's Plane instance: conservation projects, their plans, "
                            "people and budgets. Call `whoami` first — it states what this "
                            "credential may do, and every refusal is explained in terms of it. "
                            "Projects can be named by identifier (e.g. 'TAG') rather than id. "
                            "Figures come from the same code the web app uses; do not "
                            "recompute them."
                        ),
                    },
                ),
                status=status.HTTP_200_OK,
            )

        if method == "ping":
            return Response(_result(request_id, {}), status=status.HTTP_200_OK)

        # Advertised as absent in `capabilities`, but clients probe anyway and an
        # empty list is a kinder answer than "method not found" in a log.
        if method in ("resources/list", "resources/templates/list"):
            return Response(_result(request_id, {"resources": [], "resourceTemplates": []}), status=200)
        if method == "prompts/list":
            return Response(_result(request_id, {"prompts": []}), status=200)

        if method == "tools/list":
            return Response(_result(request_id, {"tools": list_tools(token)}), status=200)

        if method == "tools/call":
            if _rate_limited(token):
                return Response(
                    _result(
                        request_id,
                        _text_result(
                            f"Rate limit reached: {RATE_LIMIT_CALLS} tool calls per "
                            f"{RATE_LIMIT_WINDOW} seconds for this token. Wait and retry.",
                            is_error=True,
                        ),
                    ),
                    status=status.HTTP_200_OK,
                )
            name = params.get("name")
            arguments = params.get("arguments")
            try:
                payload = call_tool(token, name, arguments)
            except ToolError as exc:
                return Response(_result(request_id, _text_result(str(exc), is_error=True)), status=200)
            return Response(_result(request_id, _text_result(payload)), status=200)

        return Response(
            _error(request_id, -32601, f"Unknown method '{method}'."),
            status=status.HTTP_200_OK,
        )


class MCPHealthEndpoint(APIView):
    """`GET /api/arribada/mcp/health/` — unauthenticated, and says nothing.

    Exists so a deploy can prove the route is wired before anybody pastes a token
    into a client config, and so Uptime-Kuma has something to watch. It names no
    workspace, counts nothing and confirms no token, because an unauthenticated
    endpoint that reports how many tokens exist is an unauthenticated endpoint
    that reports whether this instance is worth attacking.
    """

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response(
            {
                "server": SERVER_NAME,
                "version": SERVER_VERSION,
                "protocols": list(SUPPORTED_PROTOCOLS),
                "transport": "streamable-http (POST only)",
                "time": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )
