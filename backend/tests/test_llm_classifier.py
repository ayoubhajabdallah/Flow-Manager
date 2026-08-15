from unittest.mock import MagicMock, patch

import httpx
import pytest

from flowops_api.classifier import (
    Classification,
    FallbackClassifier,
    LLMClassifier,
    LocalClassifier,
    get_classifier,
)
from flowops_api.config import Settings
from flowops_api.schemas import Category, Priority


def test_llm_classifier_success() -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"category": "NETWORK", "priority": "HIGH", "system": "VPN Core", "summary": "VPN connection drops repeatedly"}'
                }
            }
        ]
    }

    with patch("httpx.Client.post", return_value=mock_response):
        classifier = LLMClassifier(api_key="test-key", base_url="https://api.openai.com/v1")
        result = classifier.classify("VPN issue", "Cannot connect to VPN from home")

        assert result.category == Category.NETWORK
        assert result.priority == Priority.HIGH
        assert result.system == "VPN Core"
        assert result.summary == "VPN connection drops repeatedly"


def test_fallback_classifier_falls_back_on_http_error() -> None:
    primary = MagicMock(spec=LLMClassifier)
    primary.classify.side_effect = httpx.HTTPStatusError(
        "401 Unauthorized",
        request=MagicMock(),
        response=MagicMock(status_code=401),
    )
    fallback = LocalClassifier()

    hybrid = FallbackClassifier(primary=primary, fallback=fallback)
    result = hybrid.classify("SAP account locked", "Need urgent access before tomorrow")

    assert result.category == Category.ACCESS
    assert result.priority in (Priority.HIGH, Priority.CRITICAL)
    assert result.system == "SAP"


def test_fallback_classifier_falls_back_on_timeout() -> None:
    primary = MagicMock(spec=LLMClassifier)
    primary.classify.side_effect = httpx.TimeoutException("Connection timed out")
    fallback = LocalClassifier()

    hybrid = FallbackClassifier(primary=primary, fallback=fallback)
    result = hybrid.classify("Monitor broken", "Hardware screen cracked")

    assert result.category == Category.HARDWARE
    assert result.system == "Workplace IT"


def test_get_classifier_returns_local_when_provider_is_local() -> None:
    with patch("flowops_api.classifier.settings", Settings(classification_provider="local")):
        classifier = get_classifier()
        assert isinstance(classifier, LocalClassifier)


def test_get_classifier_returns_local_when_llm_has_no_key() -> None:
    with patch(
        "flowops_api.classifier.settings",
        Settings(classification_provider="llm", llm_api_key=None),
    ):
        classifier = get_classifier()
        assert isinstance(classifier, LocalClassifier)


def test_get_classifier_returns_fallback_when_llm_configured() -> None:
    with patch(
        "flowops_api.classifier.settings",
        Settings(classification_provider="llm", llm_api_key="sk-test-key-123"),
    ):
        classifier = get_classifier()
        assert isinstance(classifier, FallbackClassifier)
        assert isinstance(classifier.primary, LLMClassifier)
        assert isinstance(classifier.fallback, LocalClassifier)
