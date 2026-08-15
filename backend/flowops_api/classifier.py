import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from .config import settings
from .schemas import Category, Priority

logger = logging.getLogger("flowops.classifier")


@dataclass(frozen=True)
class Classification:
    category: Category
    priority: Priority
    system: str
    summary: str


class BaseClassifier(ABC):
    @abstractmethod
    def classify(self, title: str, description: str) -> Classification:
        """Classify a request title and description into category, priority, system, and summary."""
        raise NotImplementedError


class LocalClassifier(BaseClassifier):
    """Deterministic rule-based classifier used as default and resilient fallback."""

    def classify(self, title: str, description: str) -> Classification:
        text = f"{title} {description}".lower()

        # Category determination
        if any(word in text for word in ("password", "account", "access", "permission", "login", "locked", "mfa", "auth")):
            category = Category.ACCESS
        elif any(word in text for word in ("laptop", "monitor", "keyboard", "mouse", "headset", "hardware", "screen", "cable")):
            category = Category.HARDWARE
        elif any(word in text for word in ("install", "software", "app", "license", "sap", "salesforce", "jira", "slack")):
            category = Category.SOFTWARE
        elif any(word in text for word in ("vpn", "wifi", "network", "internet", "connection", "dns", "gateway")):
            category = Category.NETWORK
        elif any(word in text for word in ("phish", "suspicious", "malware", "security", "breach", "attachment", "virus", "hacked")):
            category = Category.SECURITY
        else:
            category = Category.OTHER

        # Priority determination
        if any(word in text for word in ("urgent", "critical", "blocked", "before tomorrow", "security", "breach", "outage", "phish", "malware", "hacked")):
            priority = Priority.CRITICAL
        elif any(word in text for word in ("tomorrow", "asap", "important", "deadline", "down", "locked")):
            priority = Priority.HIGH
        elif any(word in text for word in ("soon", "this week")):
            priority = Priority.MEDIUM
        else:
            priority = Priority.LOW

        # System extraction
        if "sap" in text:
            system = "SAP"
        elif "vpn" in text:
            system = "VPN"
        elif any(word in text for word in ("wifi", "network", "internet", "dns")):
            system = "Network"
        elif any(word in text for word in ("email", "attachment", "phish", "inbox", "outlook")):
            system = "Email"
        elif category == Category.HARDWARE:
            system = "Workplace IT"
        else:
            system = "Internal systems"

        # Summary extraction
        clean_title = title.strip()
        summary = clean_title[:237] + ("..." if len(clean_title) > 240 else "")

        return Classification(
            category=category,
            priority=priority,
            system=system,
            summary=summary,
        )


class LLMClassifier(BaseClassifier):
    """External LLM provider using OpenAI-compatible HTTP chat completions."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str = "https://api.openai.com/v1",
        timeout_seconds: float = 10.0,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def classify(self, title: str, description: str) -> Classification:
        prompt = (
            f"You are an IT service desk triage AI. Classify the following request.\n"
            f"Title: {title}\n"
            f"Description: {description}\n\n"
            f"Allowed categories: {[c.value for c in Category]}\n"
            f"Allowed priorities: {[p.value for p in Priority]}\n\n"
            f"Respond ONLY with valid JSON in this exact structure:\n"
            f'{{"category": "ACCESS|HARDWARE|SOFTWARE|NETWORK|SECURITY|OTHER", '
            f'"priority": "LOW|MEDIUM|HIGH|CRITICAL", '
            f'"system": "<short system name>", '
            f'"summary": "<concise one-sentence summary under 240 chars>"}}'
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a precise triage assistant that outputs strict JSON."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }

        url = f"{self.base_url}/chat/completions"
        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            category_str = parsed.get("category", "").upper()
            priority_str = parsed.get("priority", "").upper()

            category = Category(category_str) if category_str in Category.__members__ else Category.OTHER
            priority = Priority(priority_str) if priority_str in Priority.__members__ else Priority.MEDIUM
            system = str(parsed.get("system", "Internal systems"))[:120]
            summary = str(parsed.get("summary", title))[:240]

            return Classification(
                category=category,
                priority=priority,
                system=system,
                summary=summary,
            )


class FallbackClassifier(BaseClassifier):
    """Classifier that delegates to a primary classifier and falls back to local classification on any error."""

    def __init__(self, primary: BaseClassifier, fallback: BaseClassifier) -> None:
        self.primary = primary
        self.fallback = fallback

    def classify(self, title: str, description: str) -> Classification:
        try:
            return self.primary.classify(title, description)
        except Exception as exc:
            logger.warning(
                "Primary classifier failed (%s: %s). Falling back to local classifier.",
                type(exc).__name__,
                exc,
            )
            return self.fallback.classify(title, description)


def get_classifier() -> BaseClassifier:
    """Factory function to build the active classifier based on environment configuration."""
    local_classifier = LocalClassifier()
    provider = (settings.classification_provider or "local").lower().strip()

    if provider == "llm":
        if not settings.llm_api_key:
            logger.warning("LLM provider requested but LLM_API_KEY is not set. Using local classifier.")
            return local_classifier
        llm_classifier = LLMClassifier(
            api_key=settings.llm_api_key,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
        )
        return FallbackClassifier(primary=llm_classifier, fallback=local_classifier)

    return local_classifier