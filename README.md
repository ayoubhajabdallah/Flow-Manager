# FlowOps

[![CI](https://github.com/ayoubhajabdallah/Flow-Manager/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ayoubhajabdallah/Flow-Manager/actions/workflows/ci.yml?query=branch%3Amain)

FlowOps classifies internal support requests, assigns priorities, tracks status changes, and displays aggregated metrics in an operational dashboard.

![FlowOps dashboard](screenshots/flowops-dashboard.jpg)

## What this project demonstrates

- FastAPI REST API design with validation and filtering.
- SQLAlchemy/PostgreSQL persistence and request/status history.
- Deterministic local classification with an optional LLM classifier and local fallback.
- A React/TypeScript frontend backed by an Express proxy.
- Docker packaging and GitHub Actions CI with required PostgreSQL smoke tests.

## Architecture Overview

```text
           ┌──────────────────────────────┐
           │    React + Vite frontend     │
           │     artifacts/flowops        │
           └──────────────┬───────────────┘
                          │ HTTP /api/*
           ┌──────────────▼───────────────┐
           │     Express thin proxy       │
           │     artifacts/api-server     │
           └──────────────┬───────────────┘
                          │ /api/*, /docs, /openapi.json
           ┌──────────────▼───────────────┐
           │       FastAPI backend        │
           │       backend/flowops_api    │
           │ Request API & classification │──► In-process background tasks
           │ Status & event history       │              │
           │ Dashboard aggregation        │              ▼
           └──────────────┬───────────────┘      Webhook (n8n / HTTP)
                          │
           ┌──────────────▼───────────────┐
           │      SQLAlchemy 2.0          │
           └──────────────┬───────────────┘
                          │
           ┌──────────────▼───────────────┐
           │         PostgreSQL           │
           │   flowops_requests           │
           │   flowops_request_history    │
           └──────────────────────────────┘
```

FastAPI is the business-logic source of truth for validation, classification, status/history, and dashboard calculations. Express is a thin HTTP proxy.

Persistent events are available through the history API; the frontend status display is derived from current status. Dashboard HTTP queries refresh after request creation and status updates.

Optional OpenAI-compatible LLM classification falls back to local rules when unavailable. FastAPI background tasks dispatch `request.created` and `request.status_changed` webhooks; delivery errors are logged.

## Tech Stack

- **Backend:** Python 3.13, FastAPI, Pydantic v2, Pydantic-Settings, SQLAlchemy 2.0, Psycopg 3, HTTPX, Uvicorn.
- **Frontend/proxy:** React 19, TypeScript, Vite, Tailwind CSS, TanStack React Query, Wouter, Lucide Icons, Express; Node 24 and pnpm 10.33.4 in CI.
- **Database:** PostgreSQL 16; SQLite for isolated API tests.
- **Tooling:** Docker, Docker Compose, GitHub Actions, pytest, FastAPI TestClient, unittest.mock.

## API Contract & Documentation

FastAPI serves Swagger UI at `/docs` and OpenAPI JSON at `/openapi.json`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/healthz` | Process health (`{"status": "ok"}`); does not check database readiness |
| `GET` | `/api/requests` | List requests filtered by `search`, `status`, `category`, or `priority` |
| `POST` | `/api/requests` | Create, classify, and persist a request |
| `GET` | `/api/requests/{id}` | Retrieve request details |
| `PATCH` | `/api/requests/{id}/status` | Update status and record an event when it changes |
| `GET` | `/api/requests/{id}/history` | Retrieve recorded request events in chronological order |
| `GET` | `/api/dashboard/summary` | Return current aggregated metrics |

## Configuration & Environment Variables

Copy `.env.example` to `.env`: `cp .env.example .env` (Linux/macOS) or `Copy-Item .env.example .env` (PowerShell). Python reads `.env` from the working directory; export frontend/Express variables in the shell.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy connection string using Psycopg 3 | `postgresql+psycopg://flowops:flowops@localhost:5432/flowops` |
| `CLASSIFICATION_PROVIDER` | `local` or `llm` | `local` |
| `LLM_API_KEY` | API key for optional LLM classification | `None` |
| `LLM_MODEL` | Model sent to the classification provider | `gpt-4o-mini` |
| `LLM_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `N8N_WEBHOOK_URL` | Optional outbound event destination | `None` |
| `FASTAPI_URL` | Express upstream URL | `http://127.0.0.1:8000` |
| `PORT` | Listening port; required by Vite and Express | No default |
| `BASE_PATH` | Frontend base path; use `/` locally | Required by Vite |

## Local Setup & Development

Run commands from the repository root.

### Python API

Start PostgreSQL (`docker compose up -d postgres`). Create a virtual environment with `python -m venv .venv`; activate it using `source .venv/bin/activate` (Linux/macOS) or `.\.venv\Scripts\Activate.ps1` (PowerShell).

Then, in either shell:

```sh
python -m pip install -r backend/requirements.txt
python -m uvicorn flowops_api.main:app --app-dir backend --reload --port 8000
```

Open `http://localhost:8000/docs`. If the request table is empty, the API seeds example requests at startup.

### Frontend

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
```

Linux/macOS:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/flowops run dev
```

Windows PowerShell:

```powershell
$env:PORT = '5173'
$env:BASE_PATH = '/'
pnpm --filter @workspace/flowops run dev
```

Vite serves the UI at `http://localhost:5173`. API calls use same-origin `/api`; Vite has no API proxy. Full-stack use requires routing `/` to Vite and `/api` to Express → FastAPI.

## Docker Compose Setup

Build and start **FastAPI and PostgreSQL** (frontend and Express are not included):

```sh
docker compose up --build
```

- **API & docs:** `http://localhost:8000/docs`.
- **PostgreSQL:** `localhost:5432`, database/user/password `flowops`.
- Compose waits for PostgreSQL's health check. Data persists in the `flowops-postgres` volume.

## Testing & Verification

[GitHub Actions](.github/workflows/ci.yml) runs on pushes and pull requests and verifies:

- **27 isolated backend tests:** classification, LLM fallback, API validation/filtering, status/history, dashboard metrics, and webhook handling.
- **4 required PostgreSQL smoke tests:** health, request persistence, status/history, and dashboard queries. With `REQUIRE_POSTGRES_TESTS=1`, database connection/setup failures fail CI instead of skipping tests.
- Workspace TypeScript checks, including the frontend and Express, plus frontend production and Express builds.
- Docker Compose configuration validation and the backend Docker image build.

Run backend tests locally with the Python environment activated:

```bash
PYTHONPATH=backend python -m pytest -q backend/tests
```

PowerShell:

```powershell
$env:PYTHONPATH = 'backend'
python -m pytest -q backend/tests
```

Locally, unavailable PostgreSQL may cause skips unless `REQUIRE_POSTGRES_TESTS=1`. Point `TEST_POSTGRES_URL` at a dedicated test database; smoke tests write records.

## Current limitations / design trade-offs

- No authentication or authorization layer.
- Status values are validated, but transitions between valid statuses are not formally constrained.
- Event history is persistent; the database does not enforce immutability.
- Webhooks use in-process background tasks, with no durable queue or delivery retries.
- Dashboard calculations load request/history rows into Python; larger datasets would benefit from SQL aggregation.
- Schema setup uses SQLAlchemy `create_all` rather than versioned migrations.
