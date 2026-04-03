import uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Date, DateTime, ForeignKey, Integer, Boolean, UniqueConstraint, func

class Base(DeclarativeBase):
    pass

class Show(Base):
    __tablename__ = "shows"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    venue: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[str] = mapped_column(Date, nullable=False)
    end_date: Mapped[str] = mapped_column(Date, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Ring(Base):
    __tablename__ = "rings"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    show_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

class Division(Base):
    __tablename__ = "divisions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    show_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

class Class(Base):
    __tablename__ = "classes"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    show_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    ring_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rings.id"))
    division_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("divisions.id"))
    class_number: Mapped[str] = mapped_column(Text, nullable=False)
    class_name: Mapped[str] = mapped_column(Text, nullable=False)
    class_date: Mapped[str] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="OPEN")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Rider(Base):
    __tablename__ = "riders"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Horse(Base):
    __tablename__ = "horses"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    owner_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (UniqueConstraint("class_id", "rider_id", "horse_id", name="uq_entry_unique"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    rider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("riders.id"), nullable=False)
    horse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("horses.id"), nullable=False)
    back_number: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="ENTERED")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

    rider: Mapped[Rider] = relationship()
    horse: Mapped[Horse] = relationship()

class Result(Base):
    __tablename__ = "results"
    __table_args__ = (UniqueConstraint("class_id", "placing", "entry_id", name="uq_result"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    placing: Mapped[int] = mapped_column(Integer, nullable=False)
    is_tie: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entry: Mapped[Entry] = relationship()
