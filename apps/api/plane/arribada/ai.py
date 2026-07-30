# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# A tiny, provider-agnostic LLM client for the Arribada planning assistant.
#
# Groq is the default because the team already pays for it for the wiki, and it
# speaks the OpenAI wire protocol — so Groq, OpenAI and any other compatible
# endpoint share one code path (the `openai` package is already a Plane
# dependency). Anthropic is the exception: it gets its own SDK path, because
# shimming Claude through an OpenAI-compatible layer loses the parameters that
# matter and silently drifts when the API changes.
#
# The API KEY is resolved first, most specific source wins:
#   1. the workspace's own settings row (someone pasted a key in the UI)
#   2. ARRIBADA_AI_* environment variables (the deploy-wide default)
#   3. GROQ_API_KEY (the wiki's variable, so one key serves both)
#   4. Plane's own instance LLM_* configuration (god-mode admin)
# The workspace settings row then overrides provider/model/base_url on top of
# whichever key won — otherwise an admin who switches provider or types a model
# override and saves *without* pasting a key is told "saved" while every request
# keeps running on the env provider. `source` still names where the KEY came from.
# Nothing configured is not an error: callers get (None, reason) and the UI
# hides the AI button instead of showing a broken one.

import json
import os
import re


class AiConfigError(Exception):
    """The resolved configuration cannot be used as-is.

    Raised instead of falling back to a default that would send the workspace's
    key somewhere it was never meant to go; the message is shown to the user.
    """


# Known providers. `kind` picks the transport; `base_url`/`model` are defaults a
# workspace can override. "custom" exists so a self-hosted or future
# OpenAI-compatible endpoint needs no code change.
PROVIDERS = {
    "groq": {
        "label": "Groq",
        "kind": "openai",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "openai": {
        "label": "OpenAI (ChatGPT)",
        "kind": "openai",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "anthropic": {
        "label": "Anthropic (Claude)",
        "kind": "anthropic",
        "base_url": None,
        "model": "claude-opus-5",
    },
    "custom": {
        "label": "Custom (OpenAI-compatible)",
        "kind": "openai",
        "base_url": None,
        "model": "",
    },
}

DEFAULT_PROVIDER = "groq"


def provider_choices():
    """[{value, label, default_model}] for the settings UI."""
    return [
        {"value": key, "label": spec["label"], "default_model": spec["model"]}
        for key, spec in PROVIDERS.items()
    ]


def _instance_llm():
    """Plane's own instance-level LLM config (god-mode), or (None, None, None)."""
    try:
        from plane.license.utils.instance_value import get_configuration_value

        api_key, provider, model = get_configuration_value(
            [
                {"key": "LLM_API_KEY", "default": os.environ.get("LLM_API_KEY")},
                {"key": "LLM_PROVIDER", "default": os.environ.get("LLM_PROVIDER")},
                {"key": "LLM_MODEL", "default": os.environ.get("LLM_MODEL")},
            ]
        )
        return api_key or None, (provider or "").lower() or None, model or None
    except Exception:
        # No instance configuration table yet (fresh install) — not fatal.
        return None, None, None


def resolve_config(workspace_id=None):
    """The effective AI configuration, or None if nothing is set up.

    Returns a dict {provider, kind, base_url, model, api_key, source} — `source`
    is surfaced in the settings UI so it is obvious *where* a key came from.
    """
    from .models import WorkspaceAiSettings

    settings_row = None
    if workspace_id:
        settings_row = WorkspaceAiSettings.objects.filter(workspace_id=workspace_id).first()

    config = None

    if settings_row:
        key = settings_row.api_key_plain()
        if key:
            spec = PROVIDERS.get(settings_row.provider) or PROVIDERS[DEFAULT_PROVIDER]
            config = {
                "provider": settings_row.provider,
                "kind": spec["kind"],
                "base_url": settings_row.base_url or spec["base_url"],
                "model": settings_row.model or spec["model"],
                "api_key": key,
                "source": "workspace",
            }

    if config is None:
        env_key = os.environ.get("ARRIBADA_AI_API_KEY") or os.environ.get("GROQ_API_KEY")
        if env_key:
            provider = (os.environ.get("ARRIBADA_AI_PROVIDER") or DEFAULT_PROVIDER).lower()
            spec = PROVIDERS.get(provider) or PROVIDERS[DEFAULT_PROVIDER]
            config = {
                "provider": provider,
                "kind": spec["kind"],
                "base_url": os.environ.get("ARRIBADA_AI_BASE_URL") or spec["base_url"],
                "model": os.environ.get("ARRIBADA_AI_MODEL") or spec["model"],
                "api_key": env_key,
                "source": "environment",
            }

    if config is None:
        api_key, provider, model = _instance_llm()
        if api_key:
            spec = PROVIDERS.get(provider or "openai") or PROVIDERS["openai"]
            config = {
                "provider": provider or "openai",
                "kind": spec["kind"],
                "base_url": spec["base_url"],
                "model": model or spec["model"],
                "api_key": api_key,
                "source": "instance",
            }

    if config is None:
        return None

    # The settings row is the explicit choice someone made in the UI, so its
    # non-secret fields win over whichever source supplied the key — a provider or
    # model change saved without a key must actually take effect. `source` keeps
    # naming where the KEY came from, so a mismatch stays visible in the settings UI.
    if settings_row and settings_row.provider in PROVIDERS:
        spec = PROVIDERS[settings_row.provider]
        if settings_row.provider != config["provider"]:
            # A different provider means a different service: the endpoint and model
            # the key's source resolved belong to the old one, so take the new
            # provider's defaults instead of carrying them over.
            config["provider"] = settings_row.provider
            config["kind"] = spec["kind"]
            config["base_url"] = spec["base_url"]
            config["model"] = spec["model"]
        if settings_row.base_url:
            config["base_url"] = settings_row.base_url
        if settings_row.model:
            config["model"] = settings_row.model

    return config


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json(text):
    """Best-effort JSON object out of a model reply.

    Models fenced in ```json, prefixed with prose, or both — all common enough
    that a bare json.loads() would fail on a perfectly good answer.
    """
    if not text:
        return None
    candidates = [text]
    fenced = _FENCE_RE.search(text)
    if fenced:
        candidates.insert(0, fenced.group(1))
    # last resort: the outermost {...} span
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate.strip())
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _chat_openai(config, system, user, max_tokens):
    from openai import OpenAI

    base_url = config.get("base_url") or None
    if base_url is None and config.get("provider") == "custom":
        # PROVIDERS["custom"] has no default endpoint, and the OpenAI SDK silently
        # falls back to https://api.openai.com/v1 — which would post this workspace's
        # private key to OpenAI. Refuse loudly instead.
        raise AiConfigError(
            "The custom provider has no base URL configured - set one in the AI settings "
            "before using the assistant."
        )
    client = OpenAI(api_key=config["api_key"], base_url=base_url, timeout=90)
    kwargs = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
    }
    try:
        completion = client.chat.completions.create(
            response_format={"type": "json_object"}, **kwargs
        )
    except Exception:
        # Not every OpenAI-compatible endpoint implements JSON mode; the prompt
        # already demands JSON, so retry without it rather than fail.
        completion = client.chat.completions.create(**kwargs)
    return completion.choices[0].message.content


def _chat_anthropic(config, system, user, max_tokens):
    import anthropic

    client = anthropic.Anthropic(api_key=config["api_key"], timeout=120)
    message = client.messages.create(
        model=config["model"],
        max_tokens=max_tokens,
        # Thinking is ON by default on claude-opus-5 and max_tokens caps thinking PLUS
        # the visible answer, so most of the budget can be spent reasoning and the JSON
        # never arrives. Disabling it is accepted at effort high or below (the default).
        # No temperature/top_p/top_k either - that model family rejects them.
        thinking={"type": "disabled"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in message.content if getattr(block, "type", None) == "text")


def chat_json(config, system, user, max_tokens=4000):
    """Ask the model for a JSON object. Returns (data, error) — never raises."""
    if not config:
        return None, "No AI provider configured"
    try:
        if config["kind"] == "anthropic":
            text = _chat_anthropic(config, system, user, max_tokens)
        else:
            text = _chat_openai(config, system, user, max_tokens)
    except ImportError:
        return None, f"The {config['provider']} client library is not installed on this server"
    except AiConfigError as exc:
        # Already phrased for a human, and a misconfiguration is not a 500.
        return None, str(exc)
    except Exception as exc:  # noqa: BLE001 — the reason is shown to the user verbatim
        name = exc.__class__.__name__
        if "Authentication" in name or "PermissionDenied" in name:
            return None, f"The {config['provider']} API key was rejected"
        if "RateLimit" in name:
            return None, f"{config['provider']} rate limit reached — try again shortly"
        return None, f"{config['provider']} request failed ({name})"

    data = extract_json(text)
    if data is None:
        return None, "The model did not return usable JSON"
    return data, None
