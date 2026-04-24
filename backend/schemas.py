from pydantic import BaseModel, EmailStr, model_validator
from typing import Optional, Any
from datetime import date, datetime
from uuid import UUID


# ── Show Types ─────────────────────────────────────────────────────────────────

class ShowTypeCreate(BaseModel):
    code: str
    name: str
    config: dict[str, Any] = {}

class ShowTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None

class ShowTypeOut(BaseModel):
    id: UUID
    code: str
    name: str
    config: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Venues ─────────────────────────────────────────────────────────────────────

class VenueCreate(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None

class VenueUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None

class VenueOut(BaseModel):
    id: UUID
    name: str
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Shows ──────────────────────────────────────────────────────────────────────

class ShowCreate(BaseModel):
    name: str
    venue: Optional[str] = None
    venue_id: Optional[UUID] = None
    show_type_id: UUID
    start_date: date
    end_date: date
    status: str = "DRAFT"

class ShowUpdate(BaseModel):
    name: Optional[str] = None
    venue: Optional[str] = None
    venue_id: Optional[UUID] = None
    show_type_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None

class ShowOut(BaseModel):
    id: UUID
    name: str
    venue: Optional[str]
    venue_id: Optional[UUID]
    show_type_id: UUID
    show_type_code: Optional[str] = None
    show_type_name: Optional[str] = None
    start_date: date
    end_date: date
    status: str
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
    last_login_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Breeds ─────────────────────────────────────────────────────────────────────

class BreedCreate(BaseModel):
    name: str
    sort_order: int = 0

class BreedUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class BreedOut(BaseModel):
    id: UUID
    name: str
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Horse Colors ────────────────────────────────────────────────────────────────

class HorseColorCreate(BaseModel):
    name: str
    sort_order: int = 0

class HorseColorUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class HorseColorOut(BaseModel):
    id: UUID
    name: str
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Horse Registrations ─────────────────────────────────────────────────────────

class HorseRegistrationCreate(BaseModel):
    show_type_id: UUID
    registration_number: str

class HorseRegistrationOut(BaseModel):
    id: UUID
    horse_id: UUID
    show_type_id: UUID
    show_type_code: Optional[str] = None
    show_type_name: Optional[str] = None
    registration_number: str
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def extract_show_type(cls, v):
        if isinstance(v, dict):
            return v
        show_type = getattr(v, 'show_type', None)
        return {
            'id': v.id,
            'horse_id': v.horse_id,
            'show_type_id': v.show_type_id,
            'show_type_code': show_type.code if show_type else None,
            'show_type_name': show_type.name if show_type else None,
            'registration_number': v.registration_number,
            'created_at': v.created_at,
        }

    class Config:
        from_attributes = True


# ── Horses ─────────────────────────────────────────────────────────────────────

class HorseCreate(BaseModel):
    name: str
    owner_exhibitor_id: Optional[UUID] = None
    foaling_date: Optional[date] = None
    sex: Optional[str] = None
    breed_id: Optional[UUID] = None
    color_id: Optional[UUID] = None

class HorseUpdate(BaseModel):
    name: Optional[str] = None
    owner_exhibitor_id: Optional[UUID] = None
    foaling_date: Optional[date] = None
    sex: Optional[str] = None
    breed_id: Optional[UUID] = None
    color_id: Optional[UUID] = None

class HorseOut(BaseModel):
    id: UUID
    name: str
    owner_exhibitor_id: Optional[UUID] = None
    owner_name: Optional[str] = None
    foaling_date: Optional[date] = None
    sex: Optional[str] = None
    breed_id: Optional[UUID] = None
    breed_name: Optional[str] = None
    color_id: Optional[UUID] = None
    color_name: Optional[str] = None
    age: Optional[int] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def compute_derived(cls, v):
        if isinstance(v, dict):
            return v
        foaling_date = getattr(v, 'foaling_date', None)
        breed = getattr(v, 'breed', None)
        color = getattr(v, 'color', None)
        owner_exhibitor = getattr(v, 'owner_exhibitor', None)
        data = {
            'id': v.id,
            'name': v.name,
            'owner_exhibitor_id': v.owner_exhibitor_id,
            'owner_name': owner_exhibitor.full_name if owner_exhibitor else None,
            'foaling_date': foaling_date,
            'sex': v.sex,
            'breed_id': v.breed_id,
            'breed_name': breed.name if breed else None,
            'color_id': v.color_id,
            'color_name': color.name if color else None,
            'created_at': v.created_at,
        }
        if foaling_date:
            data['age'] = max(0, datetime.now().year - foaling_date.year)
        return data

    class Config:
        from_attributes = True


# ── Exhibitors ────────────────────────────────────────────────────────────────

class ExhibitorCreate(BaseModel):
    full_name: str

class ExhibitorUpdate(BaseModel):
    full_name: Optional[str] = None

class ExhibitorOut(BaseModel):
    id: UUID
    full_name: str
    user_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Entries ────────────────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    exhibitor_id: UUID
    horse_id: UUID
    back_number: Optional[int] = None
    status: str = "ENTERED"

class EntryUpdate(BaseModel):
    back_number: Optional[int] = None
    status: Optional[str] = None

class EntryOut(BaseModel):
    id: UUID
    class_id: UUID
    exhibitor_id: UUID
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

class ResultBulkItem(BaseModel):
    entry_id: UUID
    place: int
    is_tie: bool = False
    notes: Optional[str] = None

class ResultBulkSave(BaseModel):
    results: list[ResultBulkItem]

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


class ExhibitorCreateWithUser(BaseModel):
    full_name: str
    user_id: Optional[UUID] = None
