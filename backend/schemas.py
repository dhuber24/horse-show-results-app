from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime
from uuid import UUID


# ── Shows ──────────────────────────────────────────────────────────────────────

class ShowCreate(BaseModel):
    name: str
    venue: Optional[str] = None
    start_date: date
    end_date: date

class ShowUpdate(BaseModel):
    name: Optional[str] = None
    venue: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class ShowOut(BaseModel):
    id: UUID
    name: str
    venue: Optional[str]
    start_date: date
    end_date: date
    created_at: datetime

    class Config:
        from_attributes = True


# ── Rings ──────────────────────────────────────────────────────────────────────

class RingCreate(BaseModel):
    name: str

class RingOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str

    class Config:
        from_attributes = True


# ── Divisions ──────────────────────────────────────────────────────────────────

class DivisionCreate(BaseModel):
    name: str

class DivisionOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str

    class Config:
        from_attributes = True


# ── Classes ────────────────────────────────────────────────────────────────────

class ClassCreate(BaseModel):
    ring_id: Optional[UUID] = None
    division_id: Optional[UUID] = None
    class_number: str
    class_name: str
    class_date: date
    status: str = "OPEN"

class ClassUpdate(BaseModel):
    ring_id: Optional[UUID] = None
    division_id: Optional[UUID] = None
    class_number: Optional[str] = None
    class_name: Optional[str] = None
    class_date: Optional[date] = None
    status: Optional[str] = None

class ClassOut(BaseModel):
    id: UUID
    show_id: UUID
    ring_id: Optional[UUID]
    division_id: Optional[UUID]
    class_number: str
    class_name: str
    class_date: date
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Users ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    role: str
    full_name: str
    email: EmailStr

class UserOut(BaseModel):
    id: UUID
    role: str
    full_name: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Horses ─────────────────────────────────────────────────────────────────────

class HorseCreate(BaseModel):
    name: str
    owner_name: Optional[str] = None

class HorseOut(BaseModel):
    id: UUID
    name: str
    owner_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Riders ─────────────────────────────────────────────────────────────────────

class RiderCreate(BaseModel):
    full_name: str

class RiderOut(BaseModel):
    id: UUID
    full_name: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Entries ────────────────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    rider_id: UUID
    horse_id: UUID
    back_number: Optional[int] = None
    status: str = "ENTERED"

class EntryUpdate(BaseModel):
    back_number: Optional[int] = None
    status: Optional[str] = None

class EntryOut(BaseModel):
    id: UUID
    class_id: UUID
    rider_id: UUID
    horse_id: UUID
    back_number: Optional[int]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Results ────────────────────────────────────────────────────────────────────

class ResultCreate(BaseModel):
    entry_id: UUID
    place: int
    is_tie: bool = False
    notes: Optional[str] = None

class ResultUpdate(BaseModel):
    place: Optional[int] = None
    is_tie: Optional[bool] = None
    notes: Optional[str] = None

class ResultOut(BaseModel):
    id: UUID
    class_id: UUID
    entry_id: UUID
    place: int
    is_tie: bool
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Audit ──────────────────────────────────────────────────────────────────────

class AuditOut(BaseModel):
    id: UUID
    result_id: UUID
    changed_by: Optional[UUID]
    old_place: Optional[int]
    new_place: Optional[int]
    changed_at: datetime

    class Config:
        from_attributes = True


class RiderCreateWithUser(BaseModel):
    full_name: str
    user_id: Optional[UUID] = None
