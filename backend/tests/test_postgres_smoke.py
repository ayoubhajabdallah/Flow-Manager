import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from flowops_api.db import Base, get_db
from flowops_api.main import app, seed_requests
from flowops_api.models import Request, RequestHistory

PG_URL = os.environ.get(
    "TEST_POSTGRES_URL",
    "postgresql+psycopg://flowops:flowops@127.0.0.1:5432/flowops",
)


def is_postgres_available() -> bool:
    try:
        engine = create_engine(PG_URL, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        if os.environ.get("REQUIRE_POSTGRES_TESTS") == "1":
            raise
        return False


@pytest.mark.skipif(not is_postgres_available(), reason="PostgreSQL database not available")
class TestPostgresSmoke:
    @pytest.fixture(autouse=True)
    def setup_pg(self):
        self.engine = create_engine(PG_URL, pool_pre_ping=True)
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

        with self.SessionLocal() as session:
            seed_requests(session)

        def _get_pg_db():
            with self.SessionLocal() as session:
                yield session

        app.dependency_overrides[get_db] = _get_pg_db
        yield
        app.dependency_overrides.clear()

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_health_on_postgres(self, client: TestClient):
        res = client.get("/api/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    def test_create_and_list_on_postgres(self, client: TestClient):
        payload = {
            "title": "PostgreSQL live verification ticket",
            "description": "Verifying that PostgreSQL persists requests and history correctly.",
            "requester": "QA Automation",
        }
        res = client.post("/api/requests", json=payload)
        assert res.status_code == 201
        created = res.json()
        req_id = created["id"]
        assert created["category"] in ("SOFTWARE", "ACCESS", "OTHER", "HARDWARE", "NETWORK", "SECURITY")

        # Verify listing includes the new item
        list_res = client.get("/api/requests", params={"search": "verification ticket"})
        assert list_res.status_code == 200
        items = list_res.json()
        assert any(item["id"] == req_id for item in items)

    def test_status_update_and_history_on_postgres(self, client: TestClient):
        # Create a request
        payload = {
            "title": "Database connection drop issue",
            "description": "Network timeout when communicating with PostgreSQL server.",
            "requester": "DevOps Engineer",
        }
        create_res = client.post("/api/requests", json=payload)
        assert create_res.status_code == 201
        req_id = create_res.json()["id"]

        # Update status to IN_PROGRESS
        update1 = client.patch(f"/api/requests/{req_id}/status", json={"status": "IN_PROGRESS"})
        assert update1.status_code == 200
        assert update1.json()["status"] == "IN_PROGRESS"

        # Update status to RESOLVED
        update2 = client.patch(f"/api/requests/{req_id}/status", json={"status": "RESOLVED"})
        assert update2.status_code == 200
        assert update2.json()["status"] == "RESOLVED"

        # Check real history records
        hist_res = client.get(f"/api/requests/{req_id}/history")
        assert hist_res.status_code == 200
        history_items = hist_res.json()
        assert len(history_items) == 3
        assert history_items[0]["eventType"] == "CREATED"
        assert history_items[1]["eventType"] == "STATUS_CHANGED"
        assert history_items[1]["toStatus"] == "IN_PROGRESS"
        assert history_items[2]["eventType"] == "STATUS_CHANGED"
        assert history_items[2]["toStatus"] == "RESOLVED"

    def test_dashboard_summary_on_postgres(self, client: TestClient):
        res = client.get("/api/dashboard/summary")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] > 0
        assert "resolvedThisWeek" in data
        assert "averageFirstResponseHours" in data
        assert isinstance(data["categories"], list)
