# FlowOps

FlowOps is a personal portfolio project for turning messy internal support requests into clear, prioritized work. An employee can describe a problem in plain language, and FlowOps classifies the request, extracts a likely system, calculates urgency, and puts it into a workflow that an operations team can actually work.

This is intentionally a portfolio project, not a claim about a production enterprise deployment.

## Business problem

Internal requests often arrive through chat, email, and hallway conversations with inconsistent detail. The result is slow triage, unclear ownership, and important issues getting buried. FlowOps demonstrates a focused workflow for:

1. accepting a request;
2. classifying it into an operational category;
3. extracting a likely system and concise summary;
4. calculating a priority;
5. storing the structured record;
6. giving the team a searchable dashboard; and
7. moving the request through a visible status lifecycle.

## Architecture

The repository contains two compatible backend surfaces:

- `backend/flowops_api` is the standalone Python reference implementation requested by the brief. It uses FastAPI, SQLAlchemy, Pydantic settings, PostgreSQL, and a deterministic classifier fallback.
- `artifacts/api-server` is the workspace API service used by the live Replit preview. It implements the same `/api` contract with the workspace's generated TypeScript client and Drizzle/PostgreSQL library so the dashboard can run immediately inside the monorepo.
- `artifacts/flowops` is the React + Vite frontend. It consumes generated React Query hooks from `@workspace/api-client-react`.
- `lib/api-spec/openapi.yaml` is the API contract source of truth. Run codegen after changing it.

## Technologies

- React, Vite, TypeScript, Tailwind CSS, React Query, Wouter
- FastAPI, Pydantic, SQLAlchemy, PostgreSQL
- Express workspace API adapter, Drizzle ORM, Zod validation
- OpenAPI + Orval generated hooks and schemas
- Docker Compose for the Python API and PostgreSQL

## Local setup

### Workspace preview

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
```

Start the configured API and frontend workflows from the Replit workspace. The dashboard is available at the root preview and the API is served under `/api`.

### Python API

Python 3.13+ is recommended. Set `DATABASE_URL` to a PostgreSQL connection string, then run:

```bash
PYTHONPATH=backend uvicorn flowops_api.main:app --reload --port 8000
```

The standalone API exposes Swagger UI at `/docs` and health at `/api/healthz`.

## Docker setup

The included `docker-compose.yml` starts PostgreSQL and the FastAPI reference backend:

```bash
docker compose up --build
```

The API will be available at `http://localhost:8000`, with Swagger UI at `http://localhost:8000/docs`.

## API usage

Create a classified request:

```bash
curl -X POST http://localhost:8000/api/requests \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "SAP account is locked",
    "description": "I need access before tomorrow to approve the close.",
    "requester": "Maya Chen"
  }'
```

Useful endpoints:

- `GET /api/healthz`
- `GET /api/requests?search=&status=&category=&priority=`
- `POST /api/requests`
- `GET /api/requests/{id}`
- `PATCH /api/requests/{id}/status`
- `GET /api/dashboard/summary`

The interactive OpenAPI document is available at `/docs` for the FastAPI reference backend.

## Testing

Run the Python classifier tests:

```bash
PYTHONPATH=backend pytest -q backend/tests
```

Run workspace checks:

```bash
pnpm run typecheck
pnpm --filter @workspace/flowops run typecheck
```

## Screenshots

The live dashboard preview is the primary visual reference for this project. A screenshot can be added here after publishing the app:

`screenshots/flowops-dashboard.jpg`

## Future n8n and webhook integration

The API contract is deliberately separated from the dashboard so future automation can be added without changing the core request model. A next iteration could add:

- an outbound webhook event when a request is created or its status changes;
- an idempotency key for n8n retries;
- an n8n workflow that enriches requests with team or system ownership;
- a signed webhook receiver for external workflow events; and
- an activity timeline that records classifier and automation decisions.

The current MVP keeps those integrations out of the critical path while leaving the request routes and structured classification output ready for them.