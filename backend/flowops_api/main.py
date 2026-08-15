import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .classifier import get_classifier
from .config import settings
from .db import Base, engine, get_db
from .models import Request, RequestHistory
from .schemas import (
    Category,
    CategoryCount,
    DashboardSummary,
    HealthResponse,
    Priority,
    RequestCreate,
    RequestHistoryRead,
    RequestRead,
    RequestStatusUpdate,
    Status,
)
from .webhook import send_webhook_event

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("flowops")


def serialize_request(request: Request) -> RequestRead:
    return RequestRead(
        id=request.id,
        title=request.title,
        description=request.description,
        requester=request.requester,
        category=Category(request.category),
        priority=Priority(request.priority),
        status=Status(request.status),
        system=request.system,
        summary=request.summary,
        created_at=request.created_at,
    )


def serialize_history(item: RequestHistory) -> RequestHistoryRead:
    return RequestHistoryRead(
        id=item.id,
        request_id=item.request_id,
        event_type=item.event_type,
        from_status=Status(item.from_status) if item.from_status else None,
        to_status=Status(item.to_status),
        message=item.message,
        created_at=item.created_at,
    )


def seed_requests(session: Session) -> None:
    if session.scalar(select(Request.id).limit(1)) is not None:
        return

    classifier = get_classifier()
    examples = [
        (
            "SAP account locked before tomorrow's close",
            "My SAP account is locked and I need access before tomorrow. I am blocked from approving the quarterly close.",
            "Maya Chen",
            Status.CLASSIFIED,
        ),
        (
            "VPN drops every 10 minutes",
            "The Frankfurt VPN connection keeps dropping during customer calls. I have restarted the client and still see the issue.",
            "Jon Bell",
            Status.IN_PROGRESS,
        ),
        (
            "Need a second monitor for design reviews",
            "Requesting a second 27-inch monitor for the product design desk to review prototypes alongside tickets.",
            "Alina Ramos",
            Status.NEW,
        ),
        (
            "Suspicious invoice attachment received",
            "I received an invoice attachment from an unknown sender. I have not opened it and would like a security review.",
            "Owen Wright",
            Status.CLASSIFIED,
        ),
    ]

    for title, description, requester, req_status in examples:
        classification = classifier.classify(title, description)
        req = Request(
            title=title,
            description=description,
            requester=requester,
            category=classification.category.value,
            priority=classification.priority.value,
            status=req_status.value,
            system=classification.system,
            summary=classification.summary,
        )
        session.add(req)
        session.flush()

        # Seed creation event in history
        history_entry = RequestHistory(
            request_id=req.id,
            event_type="CREATED",
            from_status=None,
            to_status=Status.CLASSIFIED.value,
            message=f"Request created and classified as {classification.category.value} ({classification.priority.value})",
        )
        session.add(history_entry)

        # If seeded in a non-initial state, add transition history
        if req_status != Status.CLASSIFIED:
            transition_entry = RequestHistory(
                request_id=req.id,
                event_type="STATUS_CHANGED",
                from_status=Status.CLASSIFIED.value,
                to_status=req_status.value,
                message=f"Status changed from CLASSIFIED to {req_status.value}",
            )
            session.add(transition_entry)

    session.commit()
    logger.info("Database seeded with demo requests and history.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with next(get_db()) as session:
        seed_requests(session)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="FlowOps operational request triage and workflow API",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


@app.get("/api/healthz", response_model=HealthResponse, tags=["health"])
def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/api/requests", response_model=list[RequestRead], tags=["requests"])
def list_requests(
    search: str | None = Query(default=None, description="Search in title, description, requester, or system"),
    status_filter: Status | None = Query(default=None, alias="status", description="Filter by request status"),
    category: Category | None = Query(default=None, description="Filter by category"),
    priority: Priority | None = Query(default=None, description="Filter by priority"),
    db: Session = Depends(get_db),
) -> list[RequestRead]:
    query = select(Request).order_by(Request.created_at.desc())
    filters = []
    if search:
        like = f"%{search.strip()}%"
        filters.append(
            or_(
                Request.title.ilike(like),
                Request.description.ilike(like),
                Request.requester.ilike(like),
                Request.system.ilike(like),
            )
        )
    if status_filter:
        filters.append(Request.status == status_filter.value)
    if category:
        filters.append(Request.category == category.value)
    if priority:
        filters.append(Request.priority == priority.value)

    if filters:
        query = query.where(*filters)

    return [serialize_request(item) for item in db.scalars(query).all()]


@app.post(
    "/api/requests",
    response_model=RequestRead,
    status_code=status.HTTP_201_CREATED,
    tags=["requests"],
)
def create_request(
    payload: RequestCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequestRead:
    classifier = get_classifier()
    classification = classifier.classify(payload.title, payload.description)

    req = Request(
        title=payload.title.strip(),
        description=payload.description.strip(),
        requester=payload.requester.strip(),
        category=classification.category.value,
        priority=classification.priority.value,
        status=Status.CLASSIFIED.value,
        system=classification.system,
        summary=classification.summary,
    )
    db.add(req)
    db.flush()

    history = RequestHistory(
        request_id=req.id,
        event_type="CREATED",
        from_status=None,
        to_status=Status.CLASSIFIED.value,
        message=f"Request created and classified as {classification.category.value} ({classification.priority.value})",
    )
    db.add(history)
    db.commit()
    db.refresh(req)

    logger.info("Created request #%s (%s - %s)", req.id, req.category, req.priority)

    serialized = serialize_request(req)
    background_tasks.add_task(
        send_webhook_event,
        "request.created",
        serialized.model_dump(by_alias=True, mode="json"),
    )
    return serialized


@app.get("/api/requests/{request_id}", response_model=RequestRead, tags=["requests"])
def get_request(request_id: int, db: Session = Depends(get_db)) -> RequestRead:
    req = db.get(Request, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return serialize_request(req)


@app.patch("/api/requests/{request_id}/status", response_model=RequestRead, tags=["requests"])
def update_status(
    request_id: int,
    payload: RequestStatusUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequestRead:
    req = db.get(Request, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")

    old_status = req.status
    new_status = payload.status.value

    if old_status != new_status:
        req.status = new_status
        req.updated_at = datetime.now(timezone.utc)

        history = RequestHistory(
            request_id=req.id,
            event_type="STATUS_CHANGED",
            from_status=old_status,
            to_status=new_status,
            message=f"Status updated from {old_status} to {new_status}",
        )
        db.add(history)
        db.commit()
        db.refresh(req)

        logger.info("Updated request #%s status: %s -> %s", req.id, old_status, new_status)

        serialized = serialize_request(req)
        background_tasks.add_task(
            send_webhook_event,
            "request.status_changed",
            {
                "request": serialized.model_dump(by_alias=True, mode="json"),
                "fromStatus": old_status,
                "toStatus": new_status,
            },
        )
        return serialized

    return serialize_request(req)


@app.get(
    "/api/requests/{request_id}/history",
    response_model=list[RequestHistoryRead],
    tags=["requests"],
)
def get_request_history(request_id: int, db: Session = Depends(get_db)) -> list[RequestHistoryRead]:
    req = db.get(Request, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")

    query = (
        select(RequestHistory)
        .where(RequestHistory.request_id == request_id)
        .order_by(RequestHistory.created_at.asc())
    )
    items = db.scalars(query).all()
    return [serialize_history(item) for item in items]


@app.get("/api/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary(db: Session = Depends(get_db)) -> DashboardSummary:
    requests = list(db.scalars(select(Request)).all())
    total = len(requests)
    open_count = sum(r.status not in (Status.RESOLVED.value, Status.CLOSED.value) for r in requests)
    urgent_count = sum(r.priority in (Priority.HIGH.value, Priority.CRITICAL.value) for r in requests)

    # Real calculation for resolved within past 7 days
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    resolved_this_week = 0
    for r in requests:
        if r.status in (Status.RESOLVED.value, Status.CLOSED.value):
            updated_at = r.updated_at
            if updated_at is not None:
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=timezone.utc)
                if updated_at >= seven_days_ago:
                    resolved_this_week += 1
            else:
                resolved_this_week += 1

    # Real calculation for average first response time from history events
    response_times_hours: list[float] = []
    if requests:
        all_histories = list(
            db.scalars(
                select(RequestHistory)
                .where(RequestHistory.event_type == "STATUS_CHANGED")
                .order_by(RequestHistory.created_at.asc())
            ).all()
        )
        # Find the first status transition for each request
        first_transitions: dict[int, RequestHistory] = {}
        for h in all_histories:
            if h.request_id not in first_transitions:
                first_transitions[h.request_id] = h

        for r in requests:
            if r.id in first_transitions:
                first_event = first_transitions[r.id]
                req_created = r.created_at
                event_created = first_event.created_at
                if req_created.tzinfo is None:
                    req_created = req_created.replace(tzinfo=timezone.utc)
                if event_created.tzinfo is None:
                    event_created = event_created.replace(tzinfo=timezone.utc)
                diff_hours = max(0.0, (event_created - req_created).total_seconds() / 3600.0)
                response_times_hours.append(diff_hours)

    avg_first_response = (
        round(sum(response_times_hours) / len(response_times_hours), 1)
        if response_times_hours
        else 0.0
    )

    category_counts = [
        CategoryCount(
            category=cat,
            count=sum(r.category == cat.value for r in requests),
        )
        for cat in Category
    ]

    return DashboardSummary(
        total=total,
        open=open_count,
        urgent=urgent_count,
        resolvedThisWeek=resolved_this_week,
        averageFirstResponseHours=avg_first_response,
        categories=category_counts,
    )