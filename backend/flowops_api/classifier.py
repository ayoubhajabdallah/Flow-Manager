from dataclasses import dataclass

from .schemas import Category, Priority


@dataclass(frozen=True)
class Classification:
    category: Category
    priority: Priority
    system: str
    summary: str


class LocalClassifier:
    """Deterministic fallback used when no hosted LLM provider is configured."""

    def classify(self, title: str, description: str) -> Classification:
        text = f"{title} {description}".lower()

        if any(word in text for word in ("password", "account", "access", "permission", "login", "locked")):
            category = Category.ACCESS
        elif any(word in text for word in ("laptop", "monitor", "keyboard", "mouse", "headset", "hardware")):
            category = Category.HARDWARE
        elif any(word in text for word in ("install", "software", "app", "license", "sap", "salesforce")):
            category = Category.SOFTWARE
        elif any(word in text for word in ("vpn", "wifi", "network", "internet", "connection")):
            category = Category.NETWORK
        elif any(word in text for word in ("phish", "suspicious", "malware", "security", "breach", "attachment")):
            category = Category.SECURITY
        else:
            category = Category.OTHER

        if any(word in text for word in ("urgent", "critical", "blocked", "before tomorrow", "security", "breach")):
            priority = Priority.CRITICAL
        elif any(word in text for word in ("tomorrow", "asap", "important", "deadline", "down", "locked")):
            priority = Priority.HIGH
        elif any(word in text for word in ("soon", "this week")):
            priority = Priority.MEDIUM
        else:
            priority = Priority.LOW

        if "sap" in text:
            system = "SAP"
        elif "vpn" in text:
            system = "VPN"
        elif any(word in text for word in ("wifi", "network", "internet")):
            system = "Network"
        elif any(word in text for word in ("email", "attachment", "phish")):
            system = "Email"
        elif category == Category.HARDWARE:
            system = "Workplace IT"
        else:
            system = "Internal systems"

        return Classification(
            category=category,
            priority=priority,
            system=system,
            summary=title.strip()[:237] + ("..." if len(title.strip()) > 240 else ""),
        )