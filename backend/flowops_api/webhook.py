import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger("flowops.webhook")


def send_webhook_event(event_type: str, payload: dict[str, Any]) -> None:
    """Send an outbound event notification to N8N_WEBHOOK_URL if configured.

    Failures are logged but never raised to ensure the main API transaction remains safe.
    """
    webhook_url = settings.n8n_webhook_url
    if not webhook_url:
        return

    body = {
        "event": event_type,
        "payload": payload,
    }

    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(webhook_url, json=body)
            if response.is_success:
                logger.info("Webhook %s sent successfully to %s", event_type, webhook_url)
            else:
                logger.warning(
                    "Webhook %s received HTTP %s from %s: %s",
                    event_type,
                    response.status_code,
                    webhook_url,
                    response.text[:200],
                )
    except Exception as exc:
        logger.warning(
            "Failed to dispatch webhook %s to %s (%s: %s)",
            event_type,
            webhook_url,
            type(exc).__name__,
            exc,
        )
