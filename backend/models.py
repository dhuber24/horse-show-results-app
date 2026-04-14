import uuid
from datetime import date, datetime
from sqlalchemy import (
    Column, Text, Date, Boolean, Integer, ForeignKey,
    TIMESTAMP, UniqueConstraint, CheckConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base


class Show(Base):
    __tablename__ = "shows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    venue = Column(Text)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    rings = relationship("Ring", back_populates="show", cascade="all, delete")
    divisions = relationship("Division", back_populates="show", cascade="all, delete")
    classes = relationship("Class", back_populates="show", cascade="all, delete")


class Ring(Base):
    __tablename__ = "rings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)

    show = relationship("Show", back_populates="rings")
    classes = relationship("Class", back_populates="ring")


class Division(Base):
    __tablename__ = "divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)

    show = relationship("Show", back_populates="divisions")
    classes = relationship("Class", back_populates="division")


class Class(Base):
    __tablename__ = "classes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    ring_id = Column(UUID(as_uuid=True), ForeignKey("rings.id"), nullable=True)
    division_id = Column(UUID(as_uuid=True), ForeignKey("divisions.id"), nullable=True)
    class_number = Column(Text, nullable=False)
    class_name = Column(Text, nullable=False)
    class_date = Column(Date, nullable=False)
    status = Column(Text, nullable=False, default="OPEN")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="classes")
    ring = relationship("Ring", back_populates="classes")
    division = relationship("Division", back_populates="classes")
    entries = relationship("Entry", back_populates="class_", cascade="all, delete")
    results = relationship("Result", back_populates="class_", cascade="all, delete")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role = Column(Text, nullable=False)
    full_name = Column(Text, nullable=False)
    email = Column(Text, unique=True, nullable=False)
    hashed_password = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    audits = relationship("ResultAudit", back_populates="changed_by_user")
    rider = relationship("Rider", back_populates="user", uselist=False)


class Horse(Base):
    __tablename__ = "horses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    owner_name = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    entries = relationship("Entry", back_populates="horse")


class Rider(Base):
    __tablename__ = "riders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    full_name = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="rider")
    entries = relationship("Entry", back_populates="rider")


class Entry(Base):
    __tablename__ = "entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    rider_id = Column(UUID(as_uuid=True), ForeignKey("riders.id"), nullable=False)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id"), nullable=False)
    back_number = Column(Integer)
    status = Column(Text, nullable=False, default="ENTERED")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("class_id", "rider_id", "horse_id"),)

    class_ = relationship("Class", back_populates="entries")
    rider = relationship("Rider", back_populates="entries")
    horse = relationship("Horse", back_populates="entries")
    result = relationship("Result", back_populates="entry", uselist=False)


class Result(Base):
    __tablename__ = "results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    place = Column(Integer, nullable=False)
    is_tie = Column(Boolean, default=False)
    notes = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("class_id", "place", "entry_id"),
        CheckConstraint("place > 0"),
    )

    class_ = relationship("Class", back_populates="results")
    entry = relationship("Entry", back_populates="result")
    audits = relationship("ResultAudit", back_populates="result", cascade="all, delete")


class ResultAudit(Base):
    __tablename__ = "result_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    result_id = Column(UUID(as_uuid=True), ForeignKey("results.id", ondelete="CASCADE"), nullable=False)
    changed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    old_place = Column(Integer)
    new_place = Column(Integer)
    changed_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    result = relationship("Result", back_populates="audits")
    changed_by_user = relationship("User", back_populates="audits")


class ShowEntry(Base):
    __tablename__ = "show_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    rider_id = Column(UUID(as_uuid=True), ForeignKey("riders.id"), nullable=False)
    back_number = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("show_id", "rider_id"),
        UniqueConstraint("show_id", "back_number"),
    )

    show = relationship("Show")
    rider = relationship("Rider")
