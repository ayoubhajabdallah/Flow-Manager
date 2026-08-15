import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from flowops_api.db import Base, get_db
from flowops_api.main import app, seed_requests
from flowops_api.schemas import Category, Priority, Status

# In-memory SQLite for isolated automated test execution
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def override_get_db():
    with TestingSessionLocal() as session:
        yield session


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as session:
        seed_requests(session)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


def test_healthz(client: TestClient) -> None:
    response = client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_requests_seeded(client: TestClient) -> None:
    response = client.get("/api/requests")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 4
    first = data[0]
    assert "id" in first
    assert "title" in first
    assert "category" in first
    assert "priority" in first
    assert "status" in first
    assert "createdAt" in first


def test_list_requests_filtering(client: TestClient) -> None:
    # Filter by category ACCESS
    res = client.get("/api/requests", params={"category": "ACCESS"})
    assert res.status_code == 200
    access_items = res.json()
    assert len(access_items) == 1
    assert access_items[0]["category"] == "ACCESS"

    # Filter by status IN_PROGRESS
    res = client.get("/api/requests", params={"status": "IN_PROGRESS"})
    assert res.status_code == 200
    in_progress_items = res.json()
    assert len(in_progress_items) == 1
    assert in_progress_items[0]["status"] == "IN_PROGRESS"

    # Filter by search query
    res = client.get("/api/requests", params={"search": "Maya"})
    assert res.status_code == 200
    search_items = res.json()
    assert len(search_items) == 1
    assert search_items[0]["requester"] == "Maya Chen"

    # Filter by non-existent query
    res = client.get("/api/requests", params={"search": "NonExistentTermXYZ"})
    assert res.status_code == 200
    assert res.json() == []


def test_create_request_success(client: TestClient) -> None:
    payload = {
        "title": "Need urgent access to finance database",
        "description": "Password expired and locked out of PostgreSQL financial reporting DB.",
        "requester": "David Miller",
    }
    response = client.post("/api/requests", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["title"] == payload["title"]
    assert data["requester"] == payload["requester"]
    assert data["category"] == "ACCESS"
    assert data["priority"] in ("HIGH", "CRITICAL")
    assert data["status"] == "CLASSIFIED"
    assert "createdAt" in data

    new_id = data["id"]

    # Verify history event was created
    history_res = client.get(f"/api/requests/{new_id}/history")
    assert history_res.status_code == 200
    history = history_res.json()
    assert len(history) == 1
    assert history[0]["eventType"] == "CREATED"
    assert history[0]["toStatus"] == "CLASSIFIED"
    assert history[0]["requestId"] == new_id


def test_create_request_invalid_input(client: TestClient) -> None:
    # Short title (less than 2 chars)
    res = client.post(
        "/api/requests",
        json={"title": "X", "description": "Valid description long enough", "requester": "Alice"},
    )
    assert res.status_code == 422

    # Short description (less than 5 chars)
    res = client.post(
        "/api/requests",
        json={"title": "Valid title", "description": "abc", "requester": "Alice"},
    )
    assert res.status_code == 422

    # Missing fields
    res = client.post("/api/requests", json={"title": "Valid title"})
    assert res.status_code == 422


def test_get_request_detail(client: TestClient) -> None:
    # Get seeded request 1
    response = client.get("/api/requests/1")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 1
    assert "title" in data
    assert "category" in data
    assert "createdAt" in data


def test_get_request_not_found(client: TestClient) -> None:
    response = client.get("/api/requests/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Request not found"


def test_update_request_status_and_history(client: TestClient) -> None:
    # Update request 1 to IN_PROGRESS
    res = client.patch("/api/requests/1/status", json={"status": "IN_PROGRESS"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "IN_PROGRESS"

    # Update request 1 to RESOLVED
    res = client.patch("/api/requests/1/status", json={"status": "RESOLVED"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "RESOLVED"

    # Check history
    history_res = client.get("/api/requests/1/history")
    assert history_res.status_code == 200
    events = history_res.json()
    # Should have CREATED + the status changes
    assert len(events) >= 3
    event_types = [e["eventType"] for e in events]
    assert "CREATED" in event_types
    assert "STATUS_CHANGED" in event_types
    statuses = [e["toStatus"] for e in events]
    assert "IN_PROGRESS" in statuses
    assert "RESOLVED" in statuses


def test_update_status_not_found(client: TestClient) -> None:
    res = client.patch("/api/requests/999999/status", json={"status": "RESOLVED"})
    assert res.status_code == 404


def test_get_history_not_found(client: TestClient) -> None:
    res = client.get("/api/requests/999999/history")
    assert res.status_code == 404


def test_dashboard_summary(client: TestClient) -> None:
    res = client.get("/api/dashboard/summary")
    assert res.status_code == 200
    summary = res.json()

    assert "total" in summary
    assert "open" in summary
    assert "urgent" in summary
    assert "resolvedThisWeek" in summary
    assert "averageFirstResponseHours" in summary
    assert "categories" in summary

    assert summary["total"] == 4
    assert isinstance(summary["categories"], list)
    assert len(summary["categories"]) == len(Category)
    assert isinstance(summary["averageFirstResponseHours"], (int, float))
    assert summary["averageFirstResponseHours"] >= 0.0
