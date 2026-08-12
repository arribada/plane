# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import hmac
import json
import logging
import uuid

import requests
from typing import Any, Dict, List, Optional, Union

# Third party imports
from celery import shared_task

# Django imports
from django.conf import settings
from django.db.models import Prefetch
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.serializers.json import DjangoJSONEncoder
from django.template.loader import render_to_string
from django.core.exceptions import ObjectDoesNotExist

# Module imports
from plane.api.serializers import (
    CycleIssueSerializer,
    CycleSerializer,
    IssueCommentSerializer,
    IssueExpandSerializer,
    ModuleIssueSerializer,
    ModuleSerializer,
    ProjectSerializer,
    UserLiteSerializer,
    IntakeIssueSerializer,
)
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueComment,
    Module,
    ModuleIssue,
    Project,
    User,
    Webhook,
    WebhookLog,
    IntakeIssue,
    IssueLabel,
    IssueAssignee,
)
# ARRIBADA FIX: the failure policy for a webhook endpoint, kept in our own app so that the
# drift in this upstream file stays down to the call sites. Safe at module scope — it
# imports no models itself (see `_health_model`), so it cannot run before the app registry.
from plane.arribada import webhook_health
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception
from plane.utils.ip_address import validate_url
from plane.settings.mongo import MongoConnection


SERIALIZER_MAPPER = {
    "project": ProjectSerializer,
    "issue": IssueExpandSerializer,
    "cycle": CycleSerializer,
    "module": ModuleSerializer,
    "cycle_issue": CycleIssueSerializer,
    "module_issue": ModuleIssueSerializer,
    "issue_comment": IssueCommentSerializer,
    "user": UserLiteSerializer,
    "intake_issue": IntakeIssueSerializer,
}

MODEL_MAPPER = {
    "project": Project,
    "issue": Issue,
    "cycle": Cycle,
    "module": Module,
    "cycle_issue": CycleIssue,
    "module_issue": ModuleIssue,
    "issue_comment": IssueComment,
    "user": User,
    "intake_issue": IntakeIssue,
}


logger = logging.getLogger("plane.worker")


def get_issue_prefetches():
    return [
        Prefetch("label_issue", queryset=IssueLabel.objects.select_related("label")),
        Prefetch("issue_assignee", queryset=IssueAssignee.objects.select_related("assignee")),
    ]


def save_webhook_log(
    webhook: Webhook,
    request_method: str,
    request_headers: str,
    request_body: str,
    response_status: str,
    response_headers: str,
    response_body: str,
    retry_count: int,
    event_type: str,
) -> None:
    # webhook_logs
    mongo_collection = MongoConnection.get_collection("webhook_logs")

    log_data = {
        "workspace_id": str(webhook.workspace_id),
        "webhook": str(webhook.id),
        "event_type": str(event_type),
        "request_method": str(request_method),
        "request_headers": str(request_headers),
        "request_body": str(request_body),
        "response_status": str(response_status),
        "response_headers": str(response_headers),
        "response_body": str(response_body),
        "retry_count": retry_count,
    }

    mongo_save_success = False
    if mongo_collection is not None:
        try:
            # insert the log data into the mongo collection
            mongo_collection.insert_one(log_data)
            logger.info("Webhook log saved successfully to mongo")
            mongo_save_success = True
        except Exception as e:
            log_exception(e, warning=True)
            logger.error(f"Failed to save webhook log: {e}")
            mongo_save_success = False

    # if the mongo save is not successful, save the log data into the database
    if not mongo_save_success:
        try:
            # insert the log data into the database
            WebhookLog.objects.create(**log_data)
            logger.info("Webhook log saved successfully to database")
        except Exception as e:
            log_exception(e, warning=True)
            logger.error(f"Failed to save webhook log: {e}")


def get_model_data(event: str, event_id: Union[str, List[str]], many: bool = False) -> Dict[str, Any]:
    """
    Retrieve and serialize model data based on the event type.

    Args:
        event (str): The type of event/model to retrieve data for
        event_id (Union[str, List[str]]): The ID or list of IDs of the model instance(s)
        many (bool): Whether to retrieve multiple instances

    Returns:
        Dict[str, Any]: Serialized model data

    Raises:
        ValueError: If serializer is not found for the event
        ObjectDoesNotExist: If model instance is not found
    """
    model = MODEL_MAPPER.get(event)
    if model is None:
        raise ValueError(f"Model not found for event: {event}")

    try:
        if many:
            queryset = model.objects.filter(pk__in=event_id)
        else:
            queryset = model.objects.get(pk=event_id)

        serializer = SERIALIZER_MAPPER.get(event)

        if serializer is None:
            raise ValueError(f"Serializer not found for event: {event}")

        issue_prefetches = get_issue_prefetches()
        if event == "issue":
            if many:
                queryset = queryset.prefetch_related(*issue_prefetches)
            else:
                issue_id = queryset.id
                queryset = model.objects.filter(pk=issue_id).prefetch_related(*issue_prefetches).first()

            return serializer(queryset, many=many, context={"expand": ["labels", "assignees"]}).data
        else:
            return serializer(queryset, many=many).data
    except ObjectDoesNotExist:
        raise ObjectDoesNotExist(f"No {event} found with id: {event_id}")


@shared_task
def send_webhook_deactivation_email(webhook_id: str, receiver_id: str, current_site: str, reason: str) -> None:
    """
    Send an email notification when a webhook is deactivated.

    ARRIBADA FIX — this task has no caller in this fork. It was invoked from
    `webhook_send_task` when a failing endpoint was auto-deactivated, and nothing is
    auto-deactivated any more (see the ARRIBADA FIX in that task, and
    `plane/arribada/webhook_health.py`). It is left in place rather than deleted: it is
    upstream's, deleting it would widen the merge diff for no gain, and the template it
    renders says "has been deactivated" — which would now be untrue for every case that
    reaches it, so it is not reused for the breaker's alerts either. Those go to Zulip.

    Args:
        webhook_id (str): ID of the deactivated webhook
        receiver_id (str): ID of the user to receive the notification
        current_site (str): Current site URL
        reason (str): Reason for webhook deactivation
    """
    try:
        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        receiver = User.objects.get(pk=receiver_id)
        webhook = Webhook.objects.get(pk=webhook_id)

        # Get the webhook payload
        subject = "Webhook Deactivated"
        message = f"Webhook {webhook.url} has been deactivated due to failed requests."

        # Send the mail
        context = {
            "email": receiver.email,
            "message": message,
            "webhook_url": f"{current_site}/{str(webhook.workspace.slug)}/settings/webhooks/{str(webhook.id)}",
        }
        html_content = render_to_string("emails/notifications/webhook-deactivate.html", context)
        text_content = generate_plain_text_from_html(html_content)

        # Set the email connection
        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )

        # Create the email message
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=EMAIL_FROM,
            to=[receiver.email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logger.info("Email sent successfully.")
    except Exception as e:
        log_exception(e, warning=True)
        logger.error(f"Failed to send email: {e}")


@shared_task(
    bind=True,
    autoretry_for=(requests.RequestException,),
    retry_backoff=600,
    max_retries=5,
    retry_jitter=True,
)
def webhook_send_task(
    self,
    webhook_id: str,
    slug: str,
    event: str,
    event_data: Optional[Dict[str, Any]],
    action: str,
    current_site: str,
    activity: Optional[Dict[str, Any]],
) -> None:
    """
    Send webhook notifications to configured endpoints.

    Args:
        webhook (str): Webhook ID
        slug (str): Workspace slug
        event (str): Event type
        event_data (Optional[Dict[str, Any]]): Event data to be sent
        action (str): HTTP method/action
        current_site (str): Current site URL
        activity (Optional[Dict[str, Any]]): Activity data
    """
    try:
        webhook = Webhook.objects.get(id=webhook_id, workspace__slug=slug)

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Autopilot",
            # ARRIBADA FIX: the delivery id must be STABLE across this delivery's retries.
            # `uuid.uuid4()` is evaluated inside the task body, which Celery re-executes on
            # every retry, so a receiver saw a fresh id each time the same event was
            # re-sent and had nothing to deduplicate on. Now that a non-2xx actually
            # retries (see below), that is the difference between a retried event being
            # applied once and being applied six times. `self.request.id` is the Celery
            # task id, which `Task.retry` preserves across attempts and which differs
            # between genuinely distinct deliveries — exactly the identity a delivery has.
            # The uuid4 fallback covers an eager or direct call, where there is no request.
            "X-Plane-Delivery": str(self.request.id or uuid.uuid4()),
            "X-Plane-Event": event,
        }

        # # Your secret key
        event_data = json.loads(json.dumps(event_data, cls=DjangoJSONEncoder)) if event_data is not None else None

        activity = json.loads(json.dumps(activity, cls=DjangoJSONEncoder)) if activity is not None else None

        action = {
            "POST": "create",
            "PATCH": "update",
            "PUT": "update",
            "DELETE": "delete",
        }.get(action, action)

        payload = {
            "event": event,
            "action": action,
            "webhook_id": str(webhook.id),
            "workspace_id": str(webhook.workspace_id),
            "data": event_data,
            "activity": activity,
        }

        # Use HMAC for generating signature
        if webhook.secret_key:
            hmac_signature = hmac.new(
                webhook.secret_key.encode("utf-8"),
                json.dumps(payload).encode("utf-8"),
                hashlib.sha256,
            )
            signature = hmac_signature.hexdigest()
            headers["X-Plane-Signature"] = signature
    except Exception as e:
        log_exception(e)
        logger.error(f"Failed to send webhook: {e}")
        return

    try:
        # ARRIBADA FIX: do not make a request to an endpoint that is known to be failing.
        # While the breaker is open this raises CircuitOpen (a RequestException, so it
        # rides the retry policy already declared on this task) and the delivery waits on
        # its normal backoff instead of adding another doomed request. One delivery per
        # probe interval is let through to test the endpoint; a 2xx closes the breaker and
        # everything still in its retry window goes out. See plane/arribada/webhook_health.py.
        if not webhook_health.should_attempt(webhook):
            raise webhook_health.CircuitOpen(f"delivery paused: {webhook.url} is not answering")

        # Re-validate the webhook URL at send time to prevent DNS-rebinding attacks
        validate_url(
            webhook.url,
            allowed_ips=settings.WEBHOOK_ALLOWED_IPS,
            allowed_hosts=settings.WEBHOOK_ALLOWED_HOSTS,
        )

        # Send the webhook event
        response = requests.post(webhook.url, headers=headers, json=payload, timeout=30)

        # ARRIBADA FIX: a non-2xx is a FAILED delivery. Without this, `requests` returns
        # the 500 like any other response, the log below records it as the outcome of a
        # successful send, and the event is never retried — the receiver being broken was
        # indistinguishable from it being fine. Raising here routes it into the same
        # handler as a transport error, so the real status is logged once, the failure is
        # counted, and the delivery retries. Raised BEFORE the log on purpose: the handler
        # below reads the status off the exception's response, so there is still exactly
        # one log row per attempt and it carries the true status rather than a flat 500.
        response.raise_for_status()

        # Log the webhook request
        save_webhook_log(
            webhook=webhook,
            request_method=action,
            request_headers=headers,
            request_body=payload,
            response_status=response.status_code,
            response_headers=response.headers,
            response_body=response.text,
            retry_count=self.request.retries,
            event_type=event,
        )
        # ARRIBADA FIX: a success ends any failure streak and closes the breaker, which is
        # what makes recovery automatic. No-op (one SELECT, no write) when nothing is wrong.
        webhook_health.record_success(webhook)
        logger.info(f"Webhook {webhook.id} sent successfully")
    except webhook_health.CircuitOpen as e:
        # ARRIBADA FIX: this clause must come before the RequestException one below.
        # A deferred attempt is not new evidence about the endpoint — the streak that
        # opened the breaker already counted it — so it is neither logged as a delivery
        # attempt nor counted again. The event is not dropped either: it retries on the
        # backoff it already had.
        logger.info(f"Webhook {webhook.id} deferred: {e}")
        if self.request.retries >= self.max_retries:
            return
        raise
    except requests.RequestException as e:
        # ARRIBADA FIX: log the REAL response when there was one. `raise_for_status` raises
        # an HTTPError carrying its response, so a 500 from the receiver is now recorded as
        # a 500 with the receiver's body, instead of the hardcoded 500 and stringified
        # exception that a transport error produces. A person reading webhook logs to work
        # out why the wiki stopped updating needs to be able to tell those two apart.
        failed_response = getattr(e, "response", None)
        # Log the failed webhook request
        save_webhook_log(
            webhook=webhook,
            request_method=action,
            request_headers=headers,
            request_body=payload,
            response_status=(failed_response.status_code if failed_response is not None else 500),
            response_headers=(failed_response.headers if failed_response is not None else ""),
            response_body=(failed_response.text if failed_response is not None else str(e)),
            retry_count=self.request.retries,
            event_type=event,
        )
        logger.error(f"Webhook {webhook.id} failed with error: {e}")
        # ARRIBADA FIX: count the failure instead of deactivating the webhook.
        #
        # What was here set `is_active=False` as soon as ONE delivery exhausted its
        # retries, and emailed the creator. That ended the integration for an outage of a
        # few hours, needed a human who had not been told to go and switch it back on, and
        # the email was the entire notice — this fork's audit found the durable error log
        # empty for a month for exactly that reason. Deactivation is now never automatic:
        # `is_active` is a human's decision only. Sustained failure instead opens a circuit
        # breaker that pauses requests, announces itself in the Zulip channel the
        # infrastructure alerts already go to, probes the endpoint on a fixed interval and
        # re-arms itself the moment it answers.
        #
        # The retry ceiling below is UNCHANGED and deliberately so: it is what bounds the
        # queue. Not deactivating is affordable because the probe rate is decoupled from
        # the event rate, not because retrying forever became acceptable.
        webhook_health.record_failure(webhook, e)
        if self.request.retries >= self.max_retries:
            return
        # ARRIBADA FIX: re-raise the original rather than a bare `requests.RequestException()`.
        # Same retry behaviour, but the cause survives into the retry log and into the
        # alert, where "500 Server Error for url ..." is the whole diagnosis and an empty
        # exception is none of it.
        raise

    except Exception as e:
        log_exception(e)
        return


@shared_task
def webhook_activity(
    event: str,
    verb: str,
    field: Optional[str],
    old_value: Any,
    new_value: Any,
    actor_id: str | uuid.UUID,
    slug: str,
    current_site: str,
    event_id: str | uuid.UUID,
    old_identifier: Optional[str],
    new_identifier: Optional[str],
) -> None:
    """
    Process and send webhook notifications for various activities in the system.

    This task filters relevant webhooks based on the event type and sends notifications
    to all active webhooks for the workspace.

    Args:
        event (str): Type of event (project, issue, module, cycle, issue_comment)
        verb (str): Action performed (created, updated, deleted)
        field (Optional[str]): Name of the field that was changed
        old_value (Any): Previous value of the field
        new_value (Any): New value of the field
        actor_id (str | uuid.UUID): ID of the user who performed the action
        slug (str): Workspace slug
        current_site (str): Current site URL
        event_id (str | uuid.UUID): ID of the event object
        old_identifier (Optional[str]): Previous identifier if any
        new_identifier (Optional[str]): New identifier if any

    Returns:
        None

    Note:
        The function silently returns on ObjectDoesNotExist exceptions to handle
        race conditions where objects might have been deleted.
    """
    try:
        webhooks = Webhook.objects.filter(workspace__slug=slug, is_active=True)

        if event == "project":
            webhooks = webhooks.filter(project=True)

        if event == "issue":
            webhooks = webhooks.filter(issue=True)

        if event == "module" or event == "module_issue":
            webhooks = webhooks.filter(module=True)

        if event == "cycle" or event == "cycle_issue":
            webhooks = webhooks.filter(cycle=True)

        if event == "issue_comment":
            webhooks = webhooks.filter(issue_comment=True)

        for webhook in webhooks:
            webhook_send_task.delay(
                webhook_id=webhook.id,
                slug=slug,
                event=event,
                event_data=({"id": event_id} if verb == "deleted" else get_model_data(event=event, event_id=event_id)),
                action=verb,
                current_site=current_site,
                activity={
                    "field": field,
                    "new_value": new_value,
                    "old_value": old_value,
                    "actor": get_model_data(event="user", event_id=actor_id),
                    "old_identifier": old_identifier,
                    "new_identifier": new_identifier,
                },
            )
        return
    except Exception as e:
        # Return if a does not exist error occurs
        if isinstance(e, ObjectDoesNotExist):
            return
        if settings.DEBUG:
            print(e)
        log_exception(e)
        return


@shared_task
def model_activity(model_name, model_id, requested_data, current_instance, actor_id, slug, origin=None):
    """Function takes in two json and computes differences between keys of both the json"""
    if current_instance is None:
        webhook_activity.delay(
            event=model_name,
            verb="created",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=actor_id,
            slug=slug,
            current_site=origin,
            event_id=model_id,
            old_identifier=None,
            new_identifier=None,
        )
        return

    # Load the current instance
    current_instance = json.loads(current_instance) if current_instance is not None else None

    # Loop through all keys in requested data and check the current value and requested value
    for key in requested_data:
        # Check if key is present in current instance or not
        if key in current_instance:
            current_value = current_instance.get(key, None)
            requested_value = requested_data.get(key, None)
            if current_value != requested_value:
                webhook_activity.delay(
                    event=model_name,
                    verb="updated",
                    field=key,
                    old_value=current_value,
                    new_value=requested_value,
                    actor_id=actor_id,
                    slug=slug,
                    current_site=origin,
                    event_id=model_id,
                    old_identifier=None,
                    new_identifier=None,
                )

    return
