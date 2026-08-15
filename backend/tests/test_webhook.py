from unittest.mock import MagicMock, patch

import httpx

from flowops_api.config import Settings
from flowops_api.webhook import send_webhook_event


def test_webhook_does_nothing_when_unconfigured() -> None:
    with patch("flowops_api.webhook.settings", Settings(n8n_webhook_url=None)):
        with patch("httpx.Client.post") as mock_post:
            send_webhook_event("request.created", {"id": 1})
            mock_post.assert_not_called()


def test_webhook_sends_payload_when_configured() -> None:
    mock_res = MagicMock()
    mock_res.is_success = True

    with patch(
        "flowops_api.webhook.settings",
        Settings(n8n_webhook_url="https://n8n.example.com/webhook/test"),
    ):
        with patch("httpx.Client.post", return_value=mock_res) as mock_post:
            send_webhook_event("request.created", {"id": 42, "title": "Test"})
            mock_post.assert_called_once()
            call_kwargs = mock_post.call_args
            assert call_kwargs[1]["json"]["event"] == "request.created"
            assert call_kwargs[1]["json"]["payload"]["id"] == 42


def test_webhook_failure_does_not_raise_exception() -> None:
    with patch(
        "flowops_api.webhook.settings",
        Settings(n8n_webhook_url="https://n8n.example.com/webhook/test"),
    ):
        with patch("httpx.Client.post", side_effect=httpx.ConnectError("Connection refused")):
            # Must not raise an exception
            send_webhook_event("request.status_changed", {"id": 42})


def test_webhook_http_error_does_not_raise_exception() -> None:
    mock_res = MagicMock()
    mock_res.is_success = False
    mock_res.status_code = 500
    mock_res.text = "Internal Server Error"

    with patch(
        "flowops_api.webhook.settings",
        Settings(n8n_webhook_url="https://n8n.example.com/webhook/test"),
    ):
        with patch("httpx.Client.post", return_value=mock_res):
            # Must not raise an exception
            send_webhook_event("request.created", {"id": 100})
