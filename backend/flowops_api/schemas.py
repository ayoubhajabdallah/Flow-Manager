from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Category(StrEnum):
    ACCESS = "ACCESS"
    HARDWARE = "HARDWARE"
    SOFTWARE = "SOFTWARE"
    NETWORK = "NETWORK"
    SECURITY = "SECURITY"
    OTHER = "OTHER"


class Priority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Status(StrEnum):
    NEW = "NEW"
    CLASSIFIED = "CLASSIFIED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class RequestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    description: str = Field(min_length=5)
    requester: str = Field(min_length=2, max_length=160)


class RequestStatusUpdate(BaseModel):
    status: Status


class RequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    requester: str
    category: Category
    priority: Priority
    status: Status
    system: str
    summary: str
    createdAt: datetime


class CategoryCount(BaseModel):
    category: Category
    count: int


class DashboardSummary(BaseModel):
    total: int
    open: int
    urgent: int
    resolvedThisWeek: int
    averageFirstResponseHours: float
    categories: list[CategoryCount]