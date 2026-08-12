# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import logging
from urllib.parse import urlparse

# Third party imports
from rest_framework import serializers

# Django imports
from django.conf import settings

# Module imports
from .base import DynamicBaseSerializer
from plane.db.models import Webhook, WebhookLog
from plane.db.models.webhook import validate_domain, validate_schema
from plane.utils.ip_address import validate_url

logger = logging.getLogger(__name__)


class WebhookSerializer(DynamicBaseSerializer):
    url = serializers.URLField(validators=[validate_schema, validate_domain])

    def __init__(self, *args, **kwargs):
        # ARRIBADA FIX (secret leak): remember the field allowlist the caller asked for,
        # because `DynamicBaseSerializer.__init__` throws it away.
        #
        # That base class does `fields = self.expand` at `serializers/base.py:18`,
        # overwriting the caller's `fields=` with the (usually empty) expand list, so
        # `_filter_fields([])` returns every field on the model. The two read endpoints in
        # `views/webhook/base.py` pass an allowlist that deliberately omits `secret_key` —
        # and get it back anyway, on every GET and every PATCH, to any workspace admin.
        # That key is the HMAC secret the receiver verifies deliveries with; anyone holding
        # it can forge a payload the receiver will trust.
        #
        # The base-class line is the real bug and it is UPSTREAM's, but fixing it there
        # changes 37 other call sites at once, from "returns everything" to "returns only
        # what was listed" — a product-wide response change that this fork's frontend has
        # never been tested against. So the leak is closed here, where the blast radius is
        # this one serializer, and the base-class bug is reported separately rather than
        # fixed by side effect.
        self._requested_fields = kwargs.get("fields") or None
        super().__init__(*args, **kwargs)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # ARRIBADA FIX: honour the allowlist for the secret specifically. A caller that
        # passed no `fields` is one of the two endpoints whose whole job is to hand the
        # secret over once — POST and the regenerate endpoint — so they are untouched.
        # A caller that passed an allowlist and did not name `secret_key` asked not to
        # have it, and now does not.
        if self._requested_fields and "secret_key" not in self._requested_fields:
            data.pop("secret_key", None)
        return data

    def _validate_webhook_url(self, url):
        """Validate a webhook URL against SSRF and disallowed domain rules."""
        try:
            validate_url(
                url,
                allowed_ips=settings.WEBHOOK_ALLOWED_IPS,
                allowed_hosts=settings.WEBHOOK_ALLOWED_HOSTS,
            )
        except ValueError as e:
            logger.warning("Webhook URL validation failed for %s: %s", url, e)
            raise serializers.ValidationError({"url": "Invalid or disallowed webhook URL."})

        hostname = (urlparse(url).hostname or "").rstrip(".").lower()

        # Hosts explicitly trusted via WEBHOOK_ALLOWED_HOSTS bypass the
        # disallowed-domain check — they're already trusted for SSRF, so
        # the loop-back guard would only get in the way of legitimate
        # sibling services that share a parent domain with Plane.
        if hostname in settings.WEBHOOK_ALLOWED_HOSTS:
            return

        request = self.context.get("request")
        disallowed_domains = list(settings.WEBHOOK_DISALLOWED_DOMAINS)
        if request:
            request_host = request.get_host().split(":")[0].rstrip(".").lower()
            disallowed_domains.append(request_host)

        if any(hostname == domain or hostname.endswith("." + domain) for domain in disallowed_domains):
            raise serializers.ValidationError({"url": "URL domain or its subdomain is not allowed."})

    def create(self, validated_data):
        url = validated_data.get("url", None)
        self._validate_webhook_url(url)
        return Webhook.objects.create(**validated_data)

    def update(self, instance, validated_data):
        url = validated_data.get("url", None)
        if url:
            self._validate_webhook_url(url)
        return super().update(instance, validated_data)

    class Meta:
        model = Webhook
        fields = "__all__"
        read_only_fields = ["workspace", "secret_key", "deleted_at"]


class WebhookLogSerializer(DynamicBaseSerializer):
    class Meta:
        model = WebhookLog
        fields = "__all__"
        read_only_fields = ["workspace", "webhook"]
