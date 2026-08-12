import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .classifier import LocalClassifier
from .db import Base, engine, get_db
from .models import Request
from .schemas import (
    Category,
    CategoryCount,
    DashboardSummary,
    Priority,
    RequestCreate,
    RequestRead,
    RequestStatusUpdate,
    Status,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("flowops")
classifier = LocalClassifier()


def serialize_request(request: Request) -> RequestRead:
    return RequestRead(
        id=request.id,
        title=request.title,
        description=request.description,
        requester=request.requester,
        category=request.category,
        priority=request.priority,
        status=request.status,
        system=request.system,
        summary=request.summary,
        createdAt=request.created_at,
    )


def seed_requests(session: Session) -> None:
    if session.scalar(select(Request.id).limit(1)) is not None:
        return

    examples = [
        ("SAP account locked before tomorrow's close", "My SAP account is locked and I need access before tomorrow. I am blocked from approving the quarterly close.", "Maya Chen", Status.CLASSIFIED),
        ("VPN drops every 10 minutes", "The Frankfurt VPN connection keeps dropping during customer calls. I have restarted the client and still see the issue.", "Jon Bell", Status.IN_PROGRESS),
        ("Need a second monitor for design reviews", "Requesting a second 27-inch monitor for the product design desk to review prototypes alongside tickets.", "Alina Ramos", Status.NEW),
        ("Suspicious invoice attachment received", "I received an invoice attachment from an unknown sender. I have not opened it and would like a security review.", "Owen Wright", Status.CLASSIFIED),
    ]
    for title, description, requester, request_status in examples:
        classification = classifier.classify(title, description)
        session.add(
            Request(
                title=title,
                description=description,
                requester=requester,
                category=classification.category,
                priority=classification.priority,
                status=request_status,
                system=classification.system,
                summary=classification.summary,
            )
        )
    session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with next(get_db()) as session:
        seed_requests(session)
    yield


app = FastAPI(title="FlowOps API", version="1.0.0", lifespan=lifespan)


@app.get("/api/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/requests", response_model=list[RequestRead])
def list_requests(
    search: str | None = Query(default=None),
    status_filter: Status | None = Query(default=None, alias="status"),
    category: Category | None = Query(default=None),
    priority: Priority | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[RequestRead]:
    query = select(Request).order_by(Request.created_at.desc())
    filters = []
    if search:
        like = f"%{search}%"
        filters.append(or_(Request.title.ilike(like), Request.description.ilike(like), Request.requester.ilike(like), Request.system.ilike(like)))
    if status_filter:
        filters.append(Request.status == status_filter)
    if category:
        filters.append(Request.category == category)
    if priority:
        filters.append(Request.priority == priority)
    if filters:
        query = query.where(*filters)
    return [serialize_request(item) for item in db.scalars(query).all()]


@app.post("/api/requests", response_model=RequestRead, status_code=status.HTTP_201_CREATED)
def create_request(payload: RequestCreate, db: Session = Depends(get_db)) -> RequestRead:
    classification = classifier.classify(payload.title, payload.description)
    request = Request(
        **payload.model_dump(),
        category=classification.category,
        priority=classification.priority,
        status=Status.CLASSIFIED,
        system=classification.system,
        summary=classification.summary,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    logger.info("created request %s", request.id)
    return serialize_request(request)


@app.get("/api/requests/{request_id}", response_model=RequestRead)
def get_request(request_id: int, db: Session = Depends(get_db)) -> RequestRead:
    request = db.get(Request, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return serialize_request(request)


@app.patch("/api/requests/{request_id}/status", response_model=RequestRead)
def update_status(request_id: int, payload: RequestStatusUpdate, db: Session = Depends(get_db)) -> RequestRead:
    request = db.get(Request, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    request.status = payload.status
    request.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(request)
    return serialize_request(request)


@app.get("/api/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db)) -> DashboardSummary:
    requests = list(db.scalars(select(Request)).all())
    return DashboardSummary(
        total=len(requests),
        open=sum(request.status not in (Status.RESOLVED, Status.CLOSED) for request in requests),
        urgent=sum(request.priority in (Priority.HIGH, Priority.CRITICAL) for request in requests),
        resolvedThisWeek=sum(request.status == Status.RESOLVED for request in requests),
        averageFirstResponseHours=2.4,
        categories=[CategoryCount(category=category, count=sum(request.category == category for request in requests)) for category in Category],
    )