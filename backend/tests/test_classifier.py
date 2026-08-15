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
    assert "SAP account locked" in result.summary


def test_classifies_suspicious_attachment_as_security_request() -> None:
    result = LocalClassifier().classify(
        "Suspicious invoice",
        "The attachment looks like phishing and malware.",
    )

    assert result.category == Category.SECURITY
    assert result.priority == Priority.CRITICAL
    assert result.system == "Email"


def test_classifies_hardware_request() -> None:
    result = LocalClassifier().classify(
        "Broken monitor cable",
        "My second screen is flickering when moving the laptop.",
    )

    assert result.category == Category.HARDWARE
    assert result.system == "Workplace IT"


def test_classifies_vpn_network_issue() -> None:
    result = LocalClassifier().classify(
        "VPN connection drops",
        "The company VPN fails to connect every morning.",
    )

    assert result.category == Category.NETWORK
    assert result.system == "VPN"


def test_classifies_software_installation() -> None:
    result = LocalClassifier().classify(
        "Install Salesforce client",
        "Need Salesforce license and application for new sales lead.",
    )

    assert result.category == Category.SOFTWARE


def test_classifies_unrecognized_text_as_other_low() -> None:
    result = LocalClassifier().classify(
        "General question",
        "Where is the cafeteria schedule posted?",
    )

    assert result.category == Category.OTHER
    assert result.priority == Priority.LOW
    assert result.system == "Internal systems"