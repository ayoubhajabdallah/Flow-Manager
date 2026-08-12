from flowops_api.classifier import LocalClassifier
from flowops_api.schemas import Category, Priority


def test_classifies_locked_sap_account_as_high_access_request() -> None:
    result = LocalClassifier().classify(
        "SAP account locked",
        "I am blocked and need access before tomorrow.",
    )

    assert result.category == Category.ACCESS
    assert result.priority in (Priority.HIGH, Priority.CRITICAL)
    assert result.system == "SAP"


def test_classifies_suspicious_attachment_as_security_request() -> None:
    result = LocalClassifier().classify(
        "Suspicious invoice",
        "The attachment looks like phishing.",
    )

    assert result.category == Category.SECURITY
    assert result.system == "Email"