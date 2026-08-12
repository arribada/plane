# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Somewhere to remember that a webhook endpoint has stopped answering.

Upstream had nowhere to keep this, which is why its only available response to a failing
endpoint was to flip `Webhook.is_active` off and email the creator — a decision taken from
a single delivery, with no memory of whether the endpoint had been fine a minute earlier
and no way to notice it coming back. `webhook_health.py` states the policy that replaces
it; this is the table it needs.

A new table rather than columns on `db.Webhook`, for the reason every model in this app is
here: upstream owns that table, and a merge should never have to reconcile our columns with
theirs. The FK is `OneToOne` with CASCADE, so the row cannot outlive the webhook it
describes.

Rows are created lazily by the first failure, so this table stays empty on a healthy
instance and no backfill is required or wanted. Nothing reads it before it is written, so
the migration is safe to apply while the workers are running: a delivery in flight sees no
row and treats the endpoint as healthy, which is what it was.

`('db', '0121_alter_estimate_type')` matches the pin every other migration in this app uses
rather than the newest `db` migration the autodetector happened to find. `db.Webhook` has
existed since long before either, so the earlier pin is equally correct and keeps all
forty-four of our migrations depending on ONE upstream node — which is one merge conflict
to resolve if upstream ever renumbers, instead of a scattering of them.

No RunPython, so there is no data function to dump ahead of, and reversing it drops a table
that only ever held state the code rebuilds from the next failure.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0121_alter_estimate_type"),
        ("arribada", "0043_issue_external_source_index"),
    ]

    operations = [
        migrations.CreateModel(
            name="WebhookDeliveryHealth",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("consecutive_failures", models.PositiveIntegerField(default=0)),
                ("first_failure_at", models.DateTimeField(blank=True, null=True)),
                ("last_failure_at", models.DateTimeField(blank=True, null=True)),
                ("circuit_open", models.BooleanField(default=False)),
                ("opened_at", models.DateTimeField(blank=True, null=True)),
                ("last_probe_at", models.DateTimeField(blank=True, null=True)),
                ("last_alert_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "webhook",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="arribada_delivery_health",
                        to="db.webhook",
                    ),
                ),
            ],
            options={
                "verbose_name": "Webhook delivery health",
                "verbose_name_plural": "Webhook delivery health",
                "db_table": "arribada_webhook_delivery_health",
            },
        )
    ]
