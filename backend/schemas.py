from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import inspect as sa_inspect
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
    created_by_user_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Shows ──────────────────────────────────────────────────────────────────────

class ShowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    venue_id: Optional[UUID] = None
    show_type_id: UUID
    start_date: date
    end_date: date
    status: Literal["DRAFT", "PUBLISHED", "ACTIVE"] = "DRAFT"
    apha_show_number: Optional[str] = Field(default=None, max_length=50)
    aqha_show_number: Optional[str] = Field(default=None, max_length=50)
    aqha_approval_status: Literal["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "CHANGES_REQUIRED"] = "NOT_SUBMITTED"
    aqha_approval_submitted_at: Optional[date] = None
    aqha_approval_notes: Optional[str] = Field(default=None, max_length=1000)
    office_charge_cents: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

class ShowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    venue_id: Optional[UUID] = None
    show_type_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[Literal["DRAFT", "PUBLISHED", "ACTIVE", "COMPLETED"]] = None
    apha_show_number: Optional[str] = Field(default=None, max_length=50)
    aqha_show_number: Optional[str] = Field(default=None, max_length=50)
    aqha_approval_status: Optional[Literal["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "CHANGES_REQUIRED"]] = None
    aqha_approval_submitted_at: Optional[date] = None
    aqha_approval_notes: Optional[str] = Field(default=None, max_length=1000)
    office_charge_cents: Optional[int] = Field(default=None, ge=0)
    office_charge_basis: Optional[Literal["per_back_number", "per_horse"]] = None
    shavings_ban_outside: Optional[bool] = None

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

class ShowAffiliationOut(BaseModel):
    show_type_id: UUID
    show_type_code: str
    show_type_name: str

    class Config:
        from_attributes = True

class ShowAffiliationUpdate(BaseModel):
    show_type_ids: list[UUID]

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
    aqha_show_number: Optional[str] = None
    aqha_approval_status: str = "NOT_SUBMITTED"
    aqha_approval_submitted_at: Optional[date] = None
    aqha_approval_notes: Optional[str] = None
    office_charge_cents: int = 0
    office_charge_basis: str = "per_back_number"
    shavings_ban_outside: bool = False
    affiliations: list[ShowAffiliationOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ── Sanctioned Associations ────────────────────────────────────────────────────

class SanctionedAssociationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    is_active: bool = True

class SanctionedAssociationUpdate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=20)
    name: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None

class SanctionedAssociationOut(BaseModel):
    id: UUID
    code: str
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class SanctionedAssociationRequestCreate(BaseModel):
    requested_name: str = Field(min_length=1, max_length=200)
    show_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=1000)

class SanctionedAssociationRequestReview(BaseModel):
    action: Literal["approve", "reject"]
    code: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def code_required_on_approve(self):
        if self.action == "approve" and not (self.code and self.code.strip()):
            raise ValueError("code is required to approve a request")
        return self

class SanctionedAssociationRequestOut(BaseModel):
    id: UUID
    requested_name: str
    requested_by_user_id: Optional[UUID]
    show_id: Optional[UUID]
    status: str
    approved_association_id: Optional[UUID]
    reviewed_at: Optional[datetime]
    reviewed_by_user_id: Optional[UUID]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Show Sanctioning ───────────────────────────────────────────────────────────

class ShowSanctioningItem(BaseModel):
    sanctioned_association_id: UUID
    per_class_fee_cents: int = Field(ge=0)

class ShowSanctioningReplace(BaseModel):
    items: list[ShowSanctioningItem] = []

class ShowSanctioningOut(BaseModel):
    sanctioned_association_id: UUID
    code: str
    name: str
    per_class_fee_cents: int

    class Config:
        from_attributes = True


# ── User Invites ───────────────────────────────────────────────────────────────

class UserInviteCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    role: Literal["SCOREKEEPER", "GATE_STEWARD"] = "SCOREKEEPER"
    show_id: Optional[UUID] = None

class UserInviteOut(BaseModel):
    id: UUID
    email: str
    first_name: str
    last_name: str
    role: str
    show_id: Optional[UUID]
    status: str
    expires_at: datetime
    invited_by_user_id: Optional[UUID]
    created_at: datetime
    accepted_at: Optional[datetime]

    class Config:
        from_attributes = True

class UserInviteCreateResult(UserInviteOut):
    """Includes the accept URL so the issuer can share it manually until
    SMTP email delivery is configured."""
    accept_url: str
    token: str

class UserInviteByTokenOut(BaseModel):
    first_name: str
    last_name: str
    email: str
    role: str
    show_id: Optional[UUID]
    show_name: Optional[str]
    expires_at: datetime
    status: str

class UserInviteAcceptBody(BaseModel):
    password: str = Field(min_length=8, max_length=200)


# ── Rings ──────────────────────────────────────────────────────────────────────

class RingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: Optional[int] = None

class RingUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    sort_order: Optional[int] = None

class RingOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str
    sort_order: Optional[int] = None
    class_count: Optional[int] = None

    class Config:
        from_attributes = True

class RingBulkCreate(BaseModel):
    names: list[str] = Field(min_length=1)


# ── Disciplines ────────────────────────────────────────────────────────────────
# A Discipline is the overarching riding style (Western Pleasure, Hunter Under
# Saddle, Trail, ...). Formerly Division before migration 074.

ScoreType = Literal["placement", "pattern", "time"]

class DisciplineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: Optional[int] = None
    default_score_type: ScoreType = "placement"

class DisciplineUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    sort_order: Optional[int] = None
    default_score_type: Optional[ScoreType] = None

class DisciplineOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str
    sort_order: Optional[int] = None
    default_score_type: ScoreType = "placement"
    class_count: Optional[int] = None

    class Config:
        from_attributes = True

class DisciplineBulkCreate(BaseModel):
    names: list[str] = Field(min_length=1)


# ── Divisions ──────────────────────────────────────────────────────────────────
# A Division is an age/skill bracket within a Discipline (e.g. "10 & Under",
# "Walk-Trot", "Amateur"). Formerly Section before migration 074.

class DivisionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: Optional[int] = None
    discipline_ids: list[UUID] = Field(default_factory=list)

class DivisionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    sort_order: Optional[int] = None
    discipline_ids: Optional[list[UUID]] = None

class DivisionOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str
    sort_order: Optional[int] = None
    class_count: Optional[int] = None
    discipline_ids: list[UUID] = Field(default_factory=list)

    @model_validator(mode='before')
    @classmethod
    def derive_discipline_ids(cls, v):
        if isinstance(v, dict):
            return v
        disciplines = getattr(v, 'disciplines', None)
        return {
            'id': v.id,
            'show_id': v.show_id,
            'name': v.name,
            'sort_order': v.sort_order,
            'class_count': getattr(v, 'class_count', None),
            'discipline_ids': [d.id for d in (disciplines or [])],
        }

    class Config:
        from_attributes = True

class DivisionBulkCreate(BaseModel):
    names: list[str] = Field(min_length=1)
    discipline_ids: list[UUID] = Field(default_factory=list)


# ── Standard rings, disciplines, divisions (lookup) ───────────────────────────

class StandardRingOut(BaseModel):
    id: UUID
    name: str
    sort_order: int

    class Config:
        from_attributes = True

class StandardDisciplineOut(BaseModel):
    id: UUID
    show_type_id: Optional[UUID] = None
    name: str
    sort_order: int
    default_score_type: ScoreType = "placement"

    class Config:
        from_attributes = True

class StandardDivisionOut(BaseModel):
    id: UUID
    show_type_id: Optional[UUID] = None
    name: str
    sort_order: int

    class Config:
        from_attributes = True


class StandardClassOut(BaseModel):
    id: UUID
    show_type_id: UUID
    standard_discipline_id: UUID
    standard_division_id: UUID
    class_code: Optional[str] = None
    class_name: str
    default_score_type: ScoreType = "placement"
    default_entry_fee_cents: int = 0
    sort_order: int

    class Config:
        from_attributes = True


# ── Standard Setup catalog ─────────────────────────────────────────────────────

class StandardCatalogDiscipline(BaseModel):
    id: UUID
    name: str
    sort_order: int
    default_score_type: ScoreType = "placement"


class StandardCatalogDivision(BaseModel):
    id: UUID
    name: str
    sort_order: int


class StandardCatalogCell(BaseModel):
    """One (discipline × division) cell in the matrix. May contain >=1 classes."""
    standard_discipline_id: UUID
    standard_division_id: UUID
    classes: list[StandardClassOut]


class StandardCatalogOut(BaseModel):
    """Everything the Setup matrix UI needs in a single payload."""
    show_type_id: UUID
    show_type_code: str
    disciplines: list[StandardCatalogDiscipline]
    divisions: list[StandardCatalogDivision]
    cells: list[StandardCatalogCell]


# ── Setup apply (idempotent matrix-pick → per-show rows) ───────────────────────

class SetupApplyRing(BaseModel):
    """One ring to ensure exists on the show. If id is given, treat as existing."""
    id: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=120)
    sort_order: Optional[int] = None


class SetupApplyPick(BaseModel):
    """Pick a specific standard class (creates the class + disc/div/membership)
    or pick a whole cell (creates disc/div/membership only, no class).
    """
    standard_class_id: Optional[UUID] = None
    standard_discipline_id: Optional[UUID] = None
    standard_division_id: Optional[UUID] = None

    @model_validator(mode='after')
    def _check_either(self):
        if self.standard_class_id is None and (
            self.standard_discipline_id is None or self.standard_division_id is None
        ):
            raise ValueError(
                "Must provide standard_class_id OR both standard_discipline_id and standard_division_id"
            )
        return self


class SetupApplyRequest(BaseModel):
    rings: list[SetupApplyRing] = Field(default_factory=list)
    picks: list[SetupApplyPick] = Field(default_factory=list)


class SetupApplyResult(BaseModel):
    created_ring_ids: list[UUID] = Field(default_factory=list)
    created_discipline_ids: list[UUID] = Field(default_factory=list)
    created_division_ids: list[UUID] = Field(default_factory=list)
    created_class_ids: list[UUID] = Field(default_factory=list)


# ── Classes ────────────────────────────────────────────────────────────────────

class ClassCreate(BaseModel):
    ring_id: Optional[UUID] = None
    discipline_id: UUID
    division_id: UUID
    class_name: str = Field(min_length=1, max_length=200)
    class_date: date
    status: Literal["OPEN", "CLOSED"] = "OPEN"
    # Omit to derive from discipline.default_score_type at creation time.
    score_type: Optional[ScoreType] = None
    entry_fee_cents: int = Field(default=0, ge=0)

class ClassUpdate(BaseModel):
    ring_id: Optional[UUID] = None
    discipline_id: Optional[UUID] = None
    division_id: Optional[UUID] = None
    class_name: Optional[str] = Field(default=None, max_length=200)
    class_date: Optional[date] = None
    status: Optional[Literal["OPEN", "CLOSED"]] = None
    score_type: Optional[ScoreType] = None
    entry_fee_cents: Optional[int] = Field(default=None, ge=0)

class ClassReorder(BaseModel):
    class_ids: list[UUID]

class ClassAssociationCreate(BaseModel):
    show_type_id: UUID
    association_class_code: Optional[str] = Field(default=None, max_length=50)

class ClassAssociationOut(BaseModel):
    id: UUID
    class_id: UUID
    show_type_id: UUID
    show_type_code: Optional[str] = None
    show_type_name: Optional[str] = None
    association_class_code: Optional[str] = None
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
    discipline_id: UUID
    division_id: UUID
    class_number: str
    class_name: str
    class_date: date
    status: str
    score_type: str = "placement"
    entry_fee_cents: int = 0
    gate_status: str = "pending"
    sort_order: Optional[int] = None
    associations: list[ClassAssociationOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ── Show Fees ─────────────────────────────────────────────────────────────────

FeeUnit = Literal[
    'flat',
    'per_entry',
    'per_horse',
    'per_judge',
    'per_class_per_horse',
    'per_night',
    'per_stall',
    'per_bag',
    'percent_of_entry',
]


class ShowFeeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)
    amount_cents: int = Field(default=0, ge=0)
    unit: FeeUnit
    notes: Optional[str] = Field(default=None, max_length=500)
    sort_order: int = 0


class ShowFeeUpdate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    label: Optional[str] = Field(default=None, max_length=200)
    amount_cents: Optional[int] = Field(default=None, ge=0)
    unit: Optional[FeeUnit] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    sort_order: Optional[int] = None


class ShowFeeOut(BaseModel):
    id: UUID
    show_id: UUID
    code: str
    label: str
    amount_cents: int
    unit: FeeUnit
    notes: Optional[str] = None
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Show Judges ────────────────────────────────────────────────────────────────

class ShowJudgeAffiliationOut(BaseModel):
    id: UUID
    code: str
    name: str

    class Config:
        from_attributes = True


class ShowJudgeCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    affiliation_ids: list[UUID] = []
    sort_order: int = 0


class ShowJudgeUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    affiliation_ids: Optional[list[UUID]] = None
    sort_order: Optional[int] = None


class ShowJudgeOut(BaseModel):
    id: UUID
    show_id: UUID
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    affiliations: list[ShowJudgeAffiliationOut] = []
    sort_order: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Users ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    role: str = Field(min_length=1, max_length=20)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: EmailStr

class UserOut(BaseModel):
    id: UUID
    role: str
    first_name: str
    last_name: str
    full_name: str
    email: str
    last_login_at: Optional[datetime] = None
    is_approved: bool
    aqha_management_workshop_completed_at: Optional[date] = None
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

# ── Exhibitor Documents ──────────────────────────────────────────────────────────

EXHIBITOR_DOC_TYPE_LABELS = {
    'MEMBERSHIP_CARD': 'Membership Card',
    'AMATEUR_CARD': 'Amateur Card',
    'YOUTH_CARD': 'Youth Card',
    'MEDICAL': 'Medical Documentation',
    'IDENTIFICATION': 'Identification',
    'OTHER': 'Other',
}

class ExhibitorDocumentOut(BaseModel):
    id: UUID
    exhibitor_id: UUID
    document_type: str
    document_type_label: Optional[str] = None
    original_filename: str
    mime_type: str
    file_size: int
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    show_type_id: Optional[UUID] = None
    show_type_code: Optional[str] = None
    show_type_name: Optional[str] = None
    uploaded_by_user_id: Optional[UUID] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def add_label(cls, v):
        if isinstance(v, dict):
            return v
        st = getattr(v, 'show_type', None)
        return {
            'id': v.id,
            'exhibitor_id': v.exhibitor_id,
            'document_type': v.document_type,
            'document_type_label': EXHIBITOR_DOC_TYPE_LABELS.get(v.document_type, v.document_type),
            'original_filename': v.original_filename,
            'mime_type': v.mime_type,
            'file_size': v.file_size,
            'issue_date': v.issue_date,
            'expiry_date': v.expiry_date,
            'show_type_id': v.show_type_id,
            'show_type_code': st.code if st else None,
            'show_type_name': st.name if st else None,
            'uploaded_by_user_id': v.uploaded_by_user_id,
            'created_at': v.created_at,
        }

    class Config:
        from_attributes = True


class ExhibitorDocumentUpdate(BaseModel):
    show_type_id: Optional[UUID] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    clear_show_type: bool = False
    clear_issue_date: bool = False
    clear_expiry_date: bool = False


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


# ── Trainers ───────────────────────────────────────────────────────────────────

class TrainerCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    private_phone: Optional[str] = Field(default=None, max_length=30)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=200)

class TrainerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    private_phone: Optional[str] = Field(default=None, max_length=30)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=200)
    business_name: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    country: Optional[str] = Field(default=None, max_length=50)
    website: Optional[str] = Field(default=None, max_length=300)
    bio: Optional[str] = Field(default=None, max_length=2000)
    social_facebook: Optional[str] = Field(default=None, max_length=200)
    social_instagram: Optional[str] = Field(default=None, max_length=200)
    social_tiktok: Optional[str] = Field(default=None, max_length=200)
    is_public: Optional[bool] = None
    safesport_completed_at: Optional[date] = None
    background_check_expires_at: Optional[date] = None
    has_liability_insurance: Optional[bool] = None

class TrainerProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    private_email: Optional[EmailStr] = None
    private_phone: Optional[str] = Field(default=None, max_length=30)
    public_email: Optional[EmailStr] = None
    public_phone: Optional[str] = Field(default=None, max_length=30)
    current_password: Optional[str] = None
    business_name: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    country: Optional[str] = Field(default=None, max_length=50)
    website: Optional[str] = Field(default=None, max_length=300)
    bio: Optional[str] = Field(default=None, max_length=2000)
    social_facebook: Optional[str] = Field(default=None, max_length=200)
    social_instagram: Optional[str] = Field(default=None, max_length=200)
    social_tiktok: Optional[str] = Field(default=None, max_length=200)
    is_public: Optional[bool] = None
    safesport_completed_at: Optional[date] = None
    clear_safesport_completed_at: bool = False
    background_check_expires_at: Optional[date] = None
    clear_background_check_expires_at: bool = False
    has_liability_insurance: Optional[bool] = None

class TrainerOut(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    first_name: str
    last_name: str
    name: str
    private_phone: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    user_email: Optional[str] = None
    business_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    website: Optional[str] = None
    is_public: bool = False
    safesport_completed_at: Optional[date] = None
    background_check_expires_at: Optional[date] = None
    has_liability_insurance: bool = False
    horse_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class TrainerRegistrationCreate(BaseModel):
    show_type_id: UUID
    member_number: str = Field(min_length=1, max_length=100)
    status: Literal["professional", "non_pro", "general"] = "general"
    expires_at: Optional[date] = None


class TrainerRegistrationUpdate(BaseModel):
    member_number: Optional[str] = Field(default=None, min_length=1, max_length=100)
    status: Optional[Literal["professional", "non_pro", "general"]] = None
    expires_at: Optional[date] = None
    clear_expires_at: bool = False


class TrainerRegistrationOut(BaseModel):
    id: UUID
    trainer_id: UUID
    show_type_id: UUID
    show_type_code: str
    show_type_name: str
    member_number: str
    status: Literal["professional", "non_pro", "general"]
    expires_at: Optional[date] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def from_registration(cls, v):
        if isinstance(v, dict):
            return v
        show_type = getattr(v, 'show_type', None)
        return {
            'id': v.id,
            'trainer_id': v.trainer_id,
            'show_type_id': v.show_type_id,
            'show_type_code': show_type.code if show_type else '',
            'show_type_name': show_type.name if show_type else '',
            'member_number': v.member_number,
            'status': v.status,
            'expires_at': v.expires_at,
            'created_at': v.created_at,
        }


class TrainerDocumentOut(BaseModel):
    id: UUID
    trainer_id: UUID
    document_type: str
    original_filename: str
    mime_type: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Horses ─────────────────────────────────────────────────────────────────────

class HorseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = Field(default=None, max_length=200)
    trainer_phone: Optional[str] = Field(default=None, max_length=30)
    trainer_first_name: Optional[str] = Field(default=None, max_length=100)
    trainer_last_name: Optional[str] = Field(default=None, max_length=100)
    trainer_email: Optional[EmailStr] = None
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    breed_ids: Optional[list[UUID]] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: bool = False

class HorseCreateWithRegistrations(HorseCreate):
    registrations: list[HorseRegistrationCreate] = Field(default_factory=list)
    # Owner selection for exhibitor self-service: exactly one of these must apply.
    # claim_ownership=True → caller is the owner.
    # owner_exhibitor_id   → existing exhibitor (from HorseCreate parent).
    # owner_first/last/email → look up or create a new owner record.
    claim_ownership: bool = False
    owner_first_name: Optional[str] = Field(default=None, max_length=100)
    owner_last_name: Optional[str] = Field(default=None, max_length=100)
    owner_email: Optional[EmailStr] = None

class HorseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = Field(default=None, max_length=200)
    trainer_phone: Optional[str] = Field(default=None, max_length=30)
    trainer_first_name: Optional[str] = Field(default=None, max_length=100)
    trainer_last_name: Optional[str] = Field(default=None, max_length=100)
    trainer_email: Optional[EmailStr] = None
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    breed_ids: Optional[list[UUID]] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: Optional[bool] = None

class HorseOut(BaseModel):
    id: UUID
    name: str
    owner_exhibitor_id: Optional[UUID] = None
    owner_exhibitor_name: Optional[str] = None
    created_by_exhibitor_id: Optional[UUID] = None
    owner_name: Optional[str] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = None
    foaling_date: Optional[date] = None
    sex: Optional[str] = None
    breed_id: Optional[UUID] = None
    breed_name: Optional[str] = None
    breed_ids: list[UUID] = Field(default_factory=list)
    breed_names: list[str] = Field(default_factory=list)
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
        unloaded = sa_inspect(v).unloaded
        breed = None if 'breed' in unloaded else getattr(v, 'breed', None)
        breeds = [] if 'breeds' in unloaded else list(getattr(v, 'breeds', None) or [])
        if not breeds and breed:
            breeds = [breed]
        breed_ids = [b.id for b in breeds]
        breed_names = [b.name for b in breeds]
        color = getattr(v, 'color', None)
        owner_exhibitor = getattr(v, 'owner_exhibitor', None)
        trainer = getattr(v, 'trainer', None)
        data = {
            'id': v.id,
            'name': v.name,
            'owner_exhibitor_id': v.owner_exhibitor_id,
            'owner_exhibitor_name': owner_exhibitor.full_name if owner_exhibitor else None,
            'created_by_exhibitor_id': getattr(v, 'created_by_exhibitor_id', None),
            'owner_name': getattr(v, 'owner_name', None),
            'trainer_id': getattr(v, 'trainer_id', None),
            # trainer_name is always the display name: registry takes precedence over free text
            'trainer_name': trainer.name if trainer else getattr(v, 'trainer_name', None),
            'foaling_date': foaling_date,
            'sex': v.sex,
            'breed_id': breed_ids[0] if breed_ids else v.breed_id,
            'breed_name': ', '.join(breed_names) if breed_names else (breed.name if breed else None),
            'breed_ids': breed_ids,
            'breed_names': breed_names,
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

class HorseRiderOut(BaseModel):
    exhibitor_id: UUID
    full_name: str

class HorseRiderCreate(BaseModel):
    exhibitor_id: UUID


# ── Exhibitor Registrations ───────────────────────────────────────────────────

class ExhibitorRegistrationCreate(BaseModel):
    show_type_id: UUID
    member_number: str = Field(min_length=1, max_length=50)

class ExhibitorRegistrationOut(BaseModel):
    id: UUID
    show_type_id: UUID
    show_type_code: str
    show_type_name: str
    member_number: str

    model_config = ConfigDict(from_attributes=True)

# ── Exhibitors ────────────────────────────────────────────────────────────────

class ExhibitorCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None
    phone: Optional[str] = Field(default=None, max_length=30)
    address: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    zip: Optional[str] = Field(default=None, max_length=20)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=200)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=30)
    parent_guardian_name: Optional[str] = Field(default=None, max_length=200)
    parent_guardian_phone: Optional[str] = Field(default=None, max_length=30)

class ExhibitorUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None
    phone: Optional[str] = Field(default=None, max_length=30)
    address: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    zip: Optional[str] = Field(default=None, max_length=20)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=200)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=30)
    parent_guardian_name: Optional[str] = Field(default=None, max_length=200)
    parent_guardian_phone: Optional[str] = Field(default=None, max_length=30)

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
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    parent_guardian_name: Optional[str] = None
    parent_guardian_phone: Optional[str] = None
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
    gate_order: Optional[int] = None
    gate_checked_in: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


# ── Gate management ────────────────────────────────────────────────────────────

class GateEntryOut(BaseModel):
    id: UUID
    back_number: Optional[int]
    exhibitor_name: str
    horse_name: Optional[str]
    is_disqualified: bool
    gate_order: Optional[int]
    gate_checked_in: bool


class GateOrderBody(BaseModel):
    entry_ids: list[UUID] = Field(min_length=1)


class GateCheckInBody(BaseModel):
    checked_in: bool


class GateCheckInResult(BaseModel):
    entry: GateEntryOut
    # Check-in can flip the class between pending and ready server-side, so
    # the response carries the class's current gate status for the UI.
    class_gate_status: str


class GateClassStatusBody(BaseModel):
    gate_status: Literal["pending", "ready", "in_progress", "done"]


# ── Results ────────────────────────────────────────────────────────────────────

class ResultCreate(BaseModel):
    entry_id: UUID
    place: int
    raw_score: Optional[float] = None
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
    raw_score: Optional[float] = None
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
    raw_score: Optional[float] = None
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
    raw_score: Optional[float] = None
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


# ── APHA Standard Classes ───────────────────────────────────────────────────────

class AphaStandardClassOut(BaseModel):
    code: str
    name: str
    division: str
    sort_order: int
    # Auto-derived from the class name by rules/disciplines.py — surfaced so the
    # picker can preview which Division each class will land in on bulk import.
    auto_discipline: Optional[str] = None
    auto_score_type: Optional[ScoreType] = None

    @model_validator(mode='before')
    @classmethod
    def derive_discipline(cls, v):
        if isinstance(v, dict):
            return v
        from rules.disciplines import classify_class_name
        classified = classify_class_name(v.name)
        return {
            'code': v.code,
            'name': v.name,
            'division': v.division,
            'sort_order': v.sort_order,
            'auto_discipline': classified[0] if classified else None,
            'auto_score_type': classified[1] if classified else None,
        }

    class Config:
        from_attributes = True


class TrainerProfileOut(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    first_name: str
    last_name: str
    name: str
    private_email: str
    private_phone: Optional[str] = None
    public_email: Optional[str] = None
    public_phone: Optional[str] = None
    business_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    website: Optional[str] = None
    bio: Optional[str] = None
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_tiktok: Optional[str] = None
    is_public: bool = False
    safesport_completed_at: Optional[date] = None
    background_check_expires_at: Optional[date] = None
    has_liability_insurance: bool = False
    has_headshot: bool = False
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def from_trainer(cls, v):
        if isinstance(v, dict):
            return v
        user = getattr(v, 'user', None)
        docs = getattr(v, 'documents', None) or []
        return {
            'id': v.id,
            'user_id': getattr(v, 'user_id', None),
            'first_name': getattr(v, 'first_name', ''),
            'last_name': getattr(v, 'last_name', ''),
            'name': v.name,
            'private_email': user.email if user else getattr(v, 'email', None),
            'private_phone': getattr(v, 'private_phone', None),
            'public_email': getattr(v, 'email', None),
            'public_phone': getattr(v, 'phone', None),
            'business_name': getattr(v, 'business_name', None),
            'city': getattr(v, 'city', None),
            'state': getattr(v, 'state', None),
            'country': getattr(v, 'country', None),
            'website': getattr(v, 'website', None),
            'bio': getattr(v, 'bio', None),
            'social_facebook': getattr(v, 'social_facebook', None),
            'social_instagram': getattr(v, 'social_instagram', None),
            'social_tiktok': getattr(v, 'social_tiktok', None),
            'is_public': bool(getattr(v, 'is_public', False)),
            'safesport_completed_at': getattr(v, 'safesport_completed_at', None),
            'background_check_expires_at': getattr(v, 'background_check_expires_at', None),
            'has_liability_insurance': bool(getattr(v, 'has_liability_insurance', False)),
            'has_headshot': any(getattr(d, 'document_type', None) == 'HEADSHOT' for d in docs),
            'created_at': v.created_at,
        }


class TrainerPublicOut(BaseModel):
    """Ad-facing trainer card. Returned only when is_public is True.

    Raw compliance dates and policy details stay out; consumers see boolean
    badges that summarize current status.
    """
    id: UUID
    first_name: str
    last_name: str
    name: str
    business_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    website: Optional[str] = None
    bio: Optional[str] = None
    public_email: Optional[str] = None
    public_phone: Optional[str] = None
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_tiktok: Optional[str] = None
    has_headshot: bool = False
    safesport_current: bool = False
    background_check_current: bool = False
    has_liability_insurance: bool = False
    affiliations: list[TrainerRegistrationOut] = []

    class Config:
        from_attributes = True


class AqhaStandardClassOut(BaseModel):
    code: str
    name: str
    division: str
    sort_order: int
    source_year: Optional[int] = None
    notes: Optional[str] = None
    auto_discipline: Optional[str] = None
    auto_score_type: Optional[ScoreType] = None

    @model_validator(mode='before')
    @classmethod
    def derive_discipline(cls, v):
        if isinstance(v, dict):
            return v
        from rules.disciplines import classify_class_name
        classified = classify_class_name(v.name)
        return {
            'code': v.code,
            'name': v.name,
            'division': v.division,
            'sort_order': v.sort_order,
            'source_year': v.source_year,
            'notes': v.notes,
            'auto_discipline': classified[0] if classified else None,
            'auto_score_type': classified[1] if classified else None,
        }

    class Config:
        from_attributes = True


# ── Schedule Builder ───────────────────────────────────────────────────────────
# Picks are (Discipline × Divisions) matrix cells. Each pick creates one class
# per selected division (or a single class if no divisions are chosen). Score
# type falls back to discipline.default_score_type when omitted.

class ScheduleBuilderPick(BaseModel):
    discipline_id: UUID
    division_ids: list[UUID] = Field(default_factory=list)
    score_type: Optional[ScoreType] = None


class ScheduleBuilderBuild(BaseModel):
    class_date: date
    ring_id: Optional[UUID] = None
    picks: list[ScheduleBuilderPick] = Field(min_length=1)


class BulkClassItem(BaseModel):
    association_code: Optional[str] = Field(default=None, min_length=1, max_length=50)
    apha_code: Optional[str] = Field(default=None, min_length=1, max_length=50)
    aqha_code: Optional[str] = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_code(self):
        if not (self.association_code or self.apha_code or self.aqha_code):
            raise ValueError("association_code is required")
        return self

    @property
    def code(self) -> str:
        return self.association_code or self.apha_code or self.aqha_code or ""


class BulkClassCreate(BaseModel):
    class_date: date
    classes: list[BulkClassItem] = Field(min_length=1)


# ── Standard Library Class Picker ──────────────────────────────────────────────
# Quick-start picker for any show type: cartesian product of selected disciplines
# and divisions drawn from `standard_disciplines` / `standard_divisions`. The
# picker already knows each pair's discipline name, division name, and intended
# scoring, so the commit endpoint takes them verbatim — no name classification.

class ClassFromLibraryPick(BaseModel):
    discipline_name: str = Field(min_length=1, max_length=100)
    division_name: str = Field(min_length=1, max_length=100)
    default_score_type: ScoreType = "placement"


class ClassesFromLibraryCreate(BaseModel):
    class_date: date
    picks: list[ClassFromLibraryPick] = Field(min_length=1)
    ring_id: Optional[UUID] = None


class AssociationValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    class_id: Optional[str] = None
    class_code: Optional[str] = None
    entry_id: Optional[str] = None
    horse_id: Optional[str] = None
    exhibitor_id: Optional[str] = None


class AssociationValidationOut(BaseModel):
    show_id: UUID
    association: str
    error_count: int
    warning_count: int
    issues: list[AssociationValidationIssue] = []


class ExhibitorCreateWithUser(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    user_id: Optional[UUID] = None
    apha_member_number: Optional[str] = Field(default=None, max_length=50)
    apha_member_expiry: Optional[date] = None
    amateur_card_number: Optional[str] = Field(default=None, max_length=50)
    amateur_card_expiry: Optional[date] = None
    amateur_novice_codes: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None
    phone: Optional[str] = Field(default=None, max_length=30)
    address: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    zip: Optional[str] = Field(default=None, max_length=20)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=200)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=30)
    parent_guardian_name: Optional[str] = Field(default=None, max_length=200)
    parent_guardian_phone: Optional[str] = Field(default=None, max_length=30)


# ── Side Pots ──────────────────────────────────────────────────────────────────
# A side pot is an optional money pool that spans multiple classes within a
# show. Exhibitors opt in at the back-number (show_entry) level and pay a flat
# fee. The pot ranks all opt-ins by combined score across the bundled classes
# and pays out per a producer-configurable schedule.

DEFAULT_SIDE_POT_PAYOUT_SCHEDULE: dict[str, list[int]] = {
    "1-3":  [100],
    "4-7":  [70, 30],
    "8-15": [60, 30, 10],
    "16+":  [40, 25, 15, 12, 8],
}

SidePotScoringMethod = Literal["sum_placings", "sum_scores"]
SidePotEligibilityRule = Literal["all_classes", "any_class"]
SidePotStatus = Literal["open", "closed", "settled"]


def _validate_payout_schedule(v: dict[str, list[int]]) -> dict[str, list[int]]:
    if not v:
        raise ValueError("payout_schedule must have at least one band")
    for band, splits in v.items():
        if not splits:
            raise ValueError(f"payout band {band!r} must have at least one split")
        if any(p < 0 for p in splits):
            raise ValueError(f"payout band {band!r} has a negative split")
        if sum(splits) > 100:
            raise ValueError(f"payout band {band!r} sums to more than 100%")
    return v


class SidePotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    entry_fee_cents: int = Field(default=1000, ge=0)
    payback_percent: int = Field(default=100, ge=0, le=100)
    scoring_method: SidePotScoringMethod = "sum_placings"
    eligibility_rule: SidePotEligibilityRule = "all_classes"
    payout_schedule: dict[str, list[int]] = Field(
        default_factory=lambda: dict(DEFAULT_SIDE_POT_PAYOUT_SCHEDULE)
    )
    class_ids: list[UUID] = Field(min_length=1)

    @field_validator("payout_schedule")
    @classmethod
    def _check_schedule(cls, v: dict[str, list[int]]) -> dict[str, list[int]]:
        return _validate_payout_schedule(v)


class SidePotUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    entry_fee_cents: Optional[int] = Field(default=None, ge=0)
    payback_percent: Optional[int] = Field(default=None, ge=0, le=100)
    scoring_method: Optional[SidePotScoringMethod] = None
    eligibility_rule: Optional[SidePotEligibilityRule] = None
    payout_schedule: Optional[dict[str, list[int]]] = None
    status: Optional[SidePotStatus] = None
    class_ids: Optional[list[UUID]] = None

    @field_validator("payout_schedule")
    @classmethod
    def _check_schedule(
        cls, v: Optional[dict[str, list[int]]]
    ) -> Optional[dict[str, list[int]]]:
        if v is None:
            return v
        return _validate_payout_schedule(v)


class SidePotClassSummary(BaseModel):
    class_id: UUID
    class_number: str
    class_name: str
    score_type: str

    class Config:
        from_attributes = True


class SidePotOut(BaseModel):
    id: UUID
    show_id: UUID
    name: str
    description: Optional[str]
    entry_fee_cents: int
    payback_percent: int
    scoring_method: SidePotScoringMethod
    eligibility_rule: SidePotEligibilityRule
    payout_schedule: dict[str, list[int]]
    status: SidePotStatus
    settled_at: Optional[datetime]
    created_at: datetime
    classes: list[SidePotClassSummary] = []
    entry_count: int = 0
    paid_count: int = 0

    class Config:
        from_attributes = True


class SidePotEntryCreate(BaseModel):
    show_entry_id: Optional[UUID] = None
    back_number: Optional[int] = None
    paid: bool = False

    @model_validator(mode="after")
    def _require_id_or_back_number(self):
        if self.show_entry_id is None and self.back_number is None:
            raise ValueError("Provide show_entry_id or back_number")
        return self


class SidePotEntryUpdate(BaseModel):
    paid: Optional[bool] = None


class SidePotEntryOut(BaseModel):
    id: UUID
    side_pot_id: UUID
    show_entry_id: UUID
    back_number: Optional[int] = None
    exhibitor_name: Optional[str] = None
    paid: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SidePotStanding(BaseModel):
    show_entry_id: UUID
    back_number: Optional[int] = None
    exhibitor_name: Optional[str] = None
    aggregate_value: float
    place: Optional[int] = None
    is_eligible: bool
    missing_class_ids: list[UUID] = []
    paid: bool = False


class SidePotStandingsOut(BaseModel):
    side_pot_id: UUID
    status: SidePotStatus
    scoring_method: SidePotScoringMethod
    eligibility_rule: SidePotEligibilityRule
    total_pool_cents: int
    payout_pool_cents: int
    standings: list[SidePotStanding] = []
    projected_payouts: dict[str, int] = {}


class SidePotPayoutOut(BaseModel):
    id: UUID
    side_pot_id: UUID
    show_entry_id: UUID
    back_number: Optional[int] = None
    exhibitor_name: Optional[str] = None
    place: int
    payout_cents: int
    aggregate_value: float
    tiebreaker_notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
