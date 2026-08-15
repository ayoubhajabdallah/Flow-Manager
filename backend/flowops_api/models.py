from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Request(Base):
    __tablename__ = "flowops_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    requester: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    system: Mapped[str] = mapped_column(String(120), nullable=False)
    summary: Mapped[str] = mapped_column(String(240), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    history: Mapped[list["RequestHistory"]] = relationship(
        "RequestHistory",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="RequestHistory.created_at.asc()",
    )


class RequestHistory(Base):
    __tablename__ = "flowops_request_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("flowops_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    request: Mapped["Request"] = relationship("Request", back_populates="history")