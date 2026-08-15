# FlowOps

FlowOps is a portfolio-grade operations request triage and workflow application designed to transform unstructured internal support requests into classified, prioritized, and trackable work items.

Employees submit issues in plain language, and FlowOps automatically classifies the category, infers target systems, calculates priority, records an immutable audit history, and presents a real-time operational queue and metric dashboard.

---

## Architecture Overview

```
                          ┌──────────────────────────┐
                          │   React + Vite Frontend  │
                          │   (artifacts/flowops)    │
                          └─────────────┬────────────┘
                                        │
                         HTTP Requests  │ (/api/*)
                                        ▼
                          ┌──────────────────────────┐
                          │    Express Thin Proxy    │
                          │  (artifacts/api-server)  │
                          └─────────────┬────────────┘
                                        │
                         Forward Proxy  │ (/api/*, /docs, /openapi.json)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FastAPI Backend Core                              │
│                          (backend/flowops_api)                              │
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐  │
│  │   Request Workflow   │  │   Event History      │  │  Live Dashboard   │  │
│  │   & Filtering API    │  │   & Audit Timeline   │  │  Aggregation      │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └─────────┬─────────┘  │
│             │                         │                        │            │
│             ▼                         ▼                        ▼            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     SQLAlchemy 2.0 Persistence Layer                  │  │
│  └────────────────────────────────────┬──────────────────────────────────┘  │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │                               │
                        ▼                               ▼
             ┌─────────────────────┐         ┌─────────────────────┐
             │     PostgreSQL      │         │   Outbound Webhook  │
             │ (flowops_requests & │         │     (n8n / HTTP)    │
             │ flowops_req_history)│         │ (Non-blocking async)│
             └─────────────────────┘         └─────────────────────┘
```

### Key Architectural Tenets

1. **FastAPI Single Source of Truth**: All business logic (request creation, validation, triage classification, status lifecycle, history tracking, and dashboard metric calculations) resides exclusively in the FastAPI backend (`backend/flowops_api`).
2. **Thin Reverse Proxy**: The Express service (`artifacts/api-server`) serves strictly as a transparent HTTP proxy forwarding `/api/*`, `/docs`, and `/openapi.json` to FastAPI, avoiding duplicate data access or business logic.
3. **Resilient Classification Layer**:
   - **Local Rule-Based Classifier** (default): Deterministic, zero-dependency keyword classifier.
   - **LLM Classifier** (optional): OpenAI-compatible external triage provider configured via environment variables.
   - **Automatic Fallback**: If an external LLM fails, times out, or is unconfigured, the system automatically falls back to local deterministic classification without throwing unhandled exceptions to users.
4. **Persistent Event History**: Status updates and request creation events are saved to `flowops_request_history`. Metrics like `averageFirstResponseHours` are calculated from real history timestamps.
5. **Non-Blocking Outbound Webhooks**: When `N8N_WEBHOOK_URL` is set, event notifications are dispatched via background tasks. Webhook connection errors or timeouts never block API responses.

---

## Tech Stack

- **Backend**: Python 3.13+, FastAPI, Pydantic v2, Pydantic-Settings, SQLAlchemy 2.0, Psycopg 3, HTTPX, Uvicorn
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, TanStack React Query, Wouter, Lucide Icons
- **Database**: PostgreSQL 16+ (with SQLite support for isolated tests)
- **Containerization**: Docker & Docker Compose (with PostgreSQL healthcheck dependencies)
- **Testing**: Pytest, FastAPI TestClient, unittest.mock

---

## API Contract & Documentation

Interactive OpenAPI / Swagger documentation is available at `/docs`, with raw JSON at `/openapi.json`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/healthz` | System health check (`{"status": "ok"}`) |
| `GET` | `/api/requests` | List requests with query filters (`search`, `status`, `category`, `priority`) |
| `POST` | `/api/requests` | Create, classify, and persist an incoming request |
| `GET` | `/api/requests/{id}` | Retrieve request details |
| `PATCH` | `/api/requests/{id}/status` | Update request status and record transition event in history |
| `GET` | `/api/requests/{id}/history` | Retrieve full event history and lifecycle timeline for a request |
| `GET` | `/api/dashboard/summary` | Real-time aggregated operations dashboard summary |

---

## Configuration & Environment Variables

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string with psycopg3 driver | `postgresql+psycopg://flowops:flowops@localhost:5432/flowops` |
| `CLASSIFICATION_PROVIDER` | `local` (deterministic) or `llm` (external provider) | `local` |
| `LLM_API_KEY` | API key for LLM provider (required if provider is `llm`) | `None` |
| `LLM_MODEL` | Chat completion model name | `gpt-4o-mini` |
| `LLM_BASE_URL` | Base URL for OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `N8N_WEBHOOK_URL` | Optional outbound webhook endpoint for events | `None` |
| `FASTAPI_URL` | Upstream target for the Express workspace proxy | `http://127.0.0.1:8000` |

---

## Local Setup & Development

### 1. Standalone Python API

1. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```
2. Install Python dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Run the FastAPI server:
   ```bash
   PYTHONPATH=backend uvicorn flowops_api.main:app --reload --port 8000
   ```
4. Access Swagger UI at `http://localhost:8000/docs`.

### 2. Frontend Workspace Preview

1. Install JavaScript workspace dependencies:
   ```bash
   pnpm install
   ```
2. Run TypeScript build and typechecks:
   ```bash
   pnpm run typecheck
   ```
3. Start the frontend development server:
   ```bash
   pnpm --filter @workspace/flowops run dev
   ```

---

## Docker Compose Setup

Run the entire stack (PostgreSQL with healthcheck + FastAPI API):

```bash
docker compose up --build
```

- **API & Docs**: `http://localhost:8000/docs`
- **PostgreSQL**: `localhost:5432` (database `flowops`, user `flowops`)
- Data is preserved across container restarts via the `flowops-postgres` volume.

---

## Testing & Verification

The test suite covers classification rules, LLM fallback behavior, health checks, CRUD operations, query filters, status transitions, history tracking, dashboard metrics, input validation, 404 responses, and webhook failure handling.

### Run Automated Tests

```bash
PYTHONPATH=backend pytest -v backend/tests
```

### Run Workspace Typechecks

```bash
pnpm run typecheck
```

---

## Verified Capabilities

- [x] Deterministic local classifier with category, priority, system, and summary inference.
- [x] External LLM provider support with graceful, silent fallback on network/API failure.
- [x] Full request lifecycle tracking in PostgreSQL (`flowops_requests` + `flowops_request_history`).
- [x] Real dashboard metrics calculation without hardcoded placeholder figures.
- [x] Resilient background webhook event dispatching for `request.created` and `request.status_changed`.
- [x] Thin Express proxy cleanly delegating to FastAPI for workspace previews.
- [x] Automated test suite with 100% pass rate across unit, API, and PostgreSQL smoke tests.