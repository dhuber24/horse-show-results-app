from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, Any, Literal
from datetime import date, datetime
from uuid import UUID


# ── Show Types ─────────────────────────────────────────────────────────────────

class ShowTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=100)
    config: dict[str, Any] = {}

class ShowTypeUpdate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=20)
    name: Optional[str] = Field(default=None, max_length=100)
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
    name: str = Field(min_length=1, max_length=200)
    address: Optional[str] = Field(default=None, max_length=300)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)

class VenueUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=300)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)

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
    name: str = Field(min_length=1, max_length=200)
    venue: Optional[str] = Field(default=None, max_length=200)
    venue_id: Optional[UUID] = None
    show_type_id: UUID
    start_date: date
    end_date: date
    status: Literal["DRAFT", "PUBLISHED", "ACTIVE"] = "DRAFT"
    apha_show_number: Optional[str] = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

class ShowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    venue: Optional[str] = Field(default=None, max_length=200)
    venue_id: Optional[UUID] = None
    show_type_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[Literal["DRAFT", "PUBLISHED", "ACTIVE"]] = None
    apha_show_number: Optional[str] = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

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
    apha_show_number: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Rings ──────────────────────────────────────────────────────────────────────

class RingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class RingOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str

    class Config:
        from_attributes = True


# ── Divisions ──────────────────────────────────────────────────────────────────

class DivisionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

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
    class_number: str = Field(min_length=1, max_length=50)
    class_name: str = Field(min_length=1, max_length=200)
    class_date: date
    status: Literal["OPEN", "CLOSED"] = "OPEN"
    apha_class_code: Optional[str] = Field(default=None, max_length=20)

class ClassUpdate(BaseModel):
    ring_id: Optional[UUID] = None
    division_id: Optional[UUID] = None
    class_number: Optional[str] = Field(default=None, max_length=50)
    class_name: Optional[str] = Field(default=None, max_length=200)
    class_date: Optional[date] = None
    status: Optional[Literal["OPEN", "CLOSED"]] = None
    apha_class_code: Optional[str] = Field(default=None, max_length=20)

class ClassAssociationCreate(BaseModel):
    show_type_id: UUID
    association_class_code: str = Field(min_length=1, max_length=50)

class ClassAssociationOut(BaseModel):
    id: UUID
    class_id: UUID
    show_type_id: UUID
    show_type_code: Optional[str] = None
    show_type_name: Optional[str] = None
    association_class_code: str
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def extract_show_type(cls, v):
        if isinstance(v, dict):
            return v
        show_type = getattr(v, 'show_type', None)
        return {
            'id': v.id,
            'class_id': v.class_id,
            'show_type_id': v.show_type_id,
            'show_type_code': show_type.code if show_type else None,
            'show_type_name': show_type.name if show_type else None,
            'association_class_code': v.association_class_code,
            'created_at': v.created_at,
        }

    class Config:
        from_attributes = True

class ClassOut(BaseModel):
    id: UUID
    show_id: UUID
    ring_id: Optional[UUID]
    division_id: Optional[UUID]
    class_number: str
    class_name: str
    class_date: date
    status: str
    apha_class_code: Optional[str] = None
    associations: list[ClassAssociationOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ── Users ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    role: str = Field(min_length=1, max_length=20)
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr

class UserOut(BaseModel):
    id: UUID
    role: str
    full_name: str
    email: str
    last_login_at: Optional[datetime] = None
    is_approved: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Horse Documents ─────────────────────────────────────────────────────────────

DOC_TYPE_LABELS = {
    'COGGINS': 'Coggins Test (EIA)',
    'VACCINATION': 'Vaccination Records',
    'HEALTH_CERTIFICATE': 'Health Certificate (CVI)',
    'REGISTRATION': 'Registration & Membership',
}

class HorseDocumentOut(BaseModel):
    id: UUID
    horse_id: UUID
    document_type: str
    document_type_label: Optional[str] = None
    original_filename: str
    mime_type: str
    file_size: int
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    uploaded_by_user_id: Optional[UUID] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def add_label(cls, v):
        if isinstance(v, dict):
            return v
        return {
            'id': v.id,
            'horse_id': v.horse_id,
            'document_type': v.document_type,
            'document_type_label': DOC_TYPE_LABELS.get(v.document_type, v.document_type),
            'original_filename': v.original_filename,
            'mime_type': v.mime_type,
            'file_size': v.file_size,
            'issue_date': v.issue_date,
            'expiry_date': v.expiry_date,
            'uploaded_by_user_id': v.uploaded_by_user_id,
            'created_at': v.created_at,
        }

    class Config:
        from_attributes = True


# ── Breeds ─────────────────────────────────────────────────────────────────────

class BreedCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = 0

class BreedUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
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
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = 0

class HorseColorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
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
    registration_number: str = Field(min_length=1, max_length=100)

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
    name: str = Field(min_length=1, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: bool = False

class HorseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: Optional[bool] = None

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
    is_solid_paint_bred: bool = False
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
            'is_solid_paint_bred': getattr(v, 'is_solid_paint_bred', False),
            'created_at': v.created_at,
        }
        if foaling_date:
            data['age'] = max(0, datetime.now().year - foaling_date.year)
        return data

    class Config:
        from_attributes = True


# ── Exhibitors ────────────────────────────────────────────────────────────────

class ExhibitorCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None

class ExhibitorUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None

class ExhibitorOut(BaseModel):
    id: UUID
    full_name: str
    user_id: Optional[UUID] = None
    apha_member_number: Optional[str] = None
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = None
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = None
    date_of_birth: Optional[date] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Entries ────────────────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    exhibitor_id: UUID
    horse_id: UUID
    back_number: Optional[int] = None
    status: Literal["ENTERED", "WITHDRAWN"] = "ENTERED"
    apha_division: Optional[Literal["OPEN", "SOLID_PAINT_BRED", "AMATEUR", "NOVICE_AMATEUR", "YOUTH", "NOVICE_YOUTH"]] = None
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)
    is_disqualified: bool = False

class EntryUpdate(BaseModel):
    back_number: Optional[int] = None
    status: Optional[Literal["ENTERED", "WITHDRAWN"]] = None
    apha_division: Optional[Literal["OPEN", "SOLID_PAINT_BRED", "AMATEUR", "NOVICE_AMATEUR", "YOUTH", "NOVICE_YOUTH"]] = None
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)
    is_disqualified: Optional[bool] = None

class EntryOut(BaseModel):
    id: UUID
    class_id: UUID
    exhibitor_id: UUID
    horse_id: Optional[UUID]
    back_number: Optional[int]
    status: str
    apha_division: Optional[str] = None
    relationship_to_owner: Optional[str] = None
    is_disqualified: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


# ── Results ────────────────────────────────────────────────────────────────────

class ResultCreate(BaseModel):
    entry_id: UUID
    place: int
    is_tie: bool = False
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("place")
    @classmethod
    def place_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("place must be 1 or greater")
        return v

class ResultUpdate(BaseModel):
    place: Optional[int] = None
    is_tie: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("place")
    @classmethod
    def place_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 1:
            raise ValueError("place must be 1 or greater")
        return v

class ResultBulkItem(BaseModel):
    entry_id: UUID
    place: int
    is_tie: bool = False
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("place")
    @classmethod
    def place_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("place must be 1 or greater")
        return v

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
    result_id: Optional[UUID]
    changed_by: Optional[UUID]
    old_place: Optional[int]
    new_place: Optional[int]
    changed_at: datetime

    class Config:
        from_attributes = True


class ExhibitorCreateWithUser(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    user_id: Optional[UUID] = None
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None
