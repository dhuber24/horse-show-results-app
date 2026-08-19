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


# ── Associations ───────────────────────────────────────────────────────────────
# The registry of bodies a horse or person can be affiliated with. Distinct from
# ShowType, which is show configuration. See models.Association.

AssociationType = Literal["breed", "club"]


class AssociationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    association_type: AssociationType
    is_active: bool = True


class AssociationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    association_type: Optional[AssociationType] = None
    is_active: Optional[bool] = None


class AssociationOut(BaseModel):
    id: UUID
    code: str
    name: str
    association_type: AssociationType
    is_active: bool
    created_at: Optional[datetime] = None

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
    # Which health papers this show requires (migration 097). Coggins is
    # universal; a CVI follows from crossing a state line and vaccinations from
    # the venue, so those two are opt-in per show.
    requires_coggins: Optional[bool] = None
    requires_health_certificate: Optional[bool] = None
    health_certificate_valid_days: Optional[int] = Field(default=None, ge=1, le=3650)
    requires_vaccination: Optional[bool] = None
    vaccination_valid_days: Optional[int] = Field(default=None, ge=1, le=3650)
    vaccination_notes: Optional[str] = Field(default=None, max_length=2000)

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
    requires_coggins: bool = True
    requires_health_certificate: bool = False
    health_certificate_valid_days: int = 30
    requires_vaccination: bool = False
    vaccination_valid_days: int = 365
    vaccination_notes: Optional[str] = None
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
    association_id: UUID
    per_class_fee_cents: int = Field(ge=0)

class ShowSanctioningReplace(BaseModel):
    items: list[ShowSanctioningItem] = []

class ShowSanctioningOut(BaseModel):
    association_id: UUID
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
    role: Literal["SCRIBE", "GATE_STEWARD"] = "SCRIBE"
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
    results_published_at: Optional[datetime] = None
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
    # Early-bird pair. The router rejects one without the other, and rejects an
    # early rate above the standard rate — see routers/show_fees.py.
    early_amount_cents: Optional[int] = Field(default=None, ge=0)
    early_deadline: Optional[date] = None


class ShowFeeUpdate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    label: Optional[str] = Field(default=None, max_length=200)
    amount_cents: Optional[int] = Field(default=None, ge=0)
    unit: Optional[FeeUnit] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    sort_order: Optional[int] = None
    early_amount_cents: Optional[int] = Field(default=None, ge=0)
    early_deadline: Optional[date] = None


class ShowFeeOut(BaseModel):
    id: UUID
    show_id: UUID
    code: str
    label: str
    amount_cents: int
    unit: FeeUnit
    notes: Optional[str] = None
    sort_order: int
    early_amount_cents: Optional[int] = None
    early_deadline: Optional[date] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Show Judges ────────────────────────────────────────────────────────────────

class JudgeAssociationOut(BaseModel):
    id: UUID
    code: str
    name: str

    class Config:
        from_attributes = True


class JudgeCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    association_ids: list[UUID] = []


class JudgeUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    association_ids: Optional[list[UUID]] = None
    is_active: Optional[bool] = None


class JudgeOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool = True
    associations: list[JudgeAssociationOut] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ShowJudgeCreate(BaseModel):
    """Assign an existing registry judge to the show. Details are read from the
    registry — the show never restates them."""
    judge_id: UUID
    sort_order: int = 0


class ShowJudgeUpdate(BaseModel):
    sort_order: Optional[int] = None


class PublicShowJudgeOut(BaseModel):
    """A show's judges as the program lists them — names only.

    Placings are published per judge, so the public results screens need to
    label the columns. That needs the name and nothing else: email and phone
    stay on the staff endpoint.
    """
    id: UUID
    judge_id: UUID
    first_name: str
    last_name: str
    sort_order: Optional[int] = None

    class Config:
        from_attributes = True


class ShowJudgeOut(BaseModel):
    id: UUID
    show_id: UUID
    judge_id: UUID
    # Flattened from the registry for display; not stored on show_judges.
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    associations: list[JudgeAssociationOut] = []
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
    association_id: Optional[UUID] = None
    association_code: Optional[str] = None
    association_name: Optional[str] = None
    association_type: Optional[AssociationType] = None
    uploaded_by_user_id: Optional[UUID] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def add_label(cls, v):
        if isinstance(v, dict):
            return v
        assoc = getattr(v, 'association', None)
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
            'association_id': v.association_id,
            'association_code': assoc.code if assoc else None,
            'association_name': assoc.name if assoc else None,
            'association_type': assoc.association_type if assoc else None,
            'uploaded_by_user_id': v.uploaded_by_user_id,
            'created_at': v.created_at,
        }

    class Config:
        from_attributes = True


class ExhibitorDocumentUpdate(BaseModel):
    association_id: Optional[UUID] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    clear_association: bool = False
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


# ── Document Extraction ─────────────────────────────────────────────────────────

class DocumentExtractionOut(BaseModel):
    """What the model read off a document, for the uploader to review.

    `fields` is the raw extraction, returned as-is rather than flattened onto
    named attributes so the extraction schema can grow without a schema change
    here. `status` is always present; on anything other than 'succeeded' the
    uploader falls back to typing the form by hand and `message` explains why.
    """
    extraction_id: UUID
    status: str
    message: Optional[str] = None
    fields: dict = Field(default_factory=dict)
    low_confidence_fields: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


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
    association_id: UUID
    registration_number: str = Field(min_length=1, max_length=100)

class HorseRegistrationOut(BaseModel):
    id: UUID
    horse_id: UUID
    association_id: UUID
    association_code: Optional[str] = None
    association_name: Optional[str] = None
    association_type: Optional[AssociationType] = None
    registration_number: str
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def extract_association(cls, v):
        if isinstance(v, dict):
            return v
        association = getattr(v, 'association', None)
        return {
            'id': v.id,
            'horse_id': v.horse_id,
            'association_id': v.association_id,
            'association_code': association.code if association else None,
            'association_name': association.name if association else None,
            'association_type': association.association_type if association else None,
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
    association_id: UUID
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
    association_id: UUID
    association_code: str
    association_name: str
    association_type: Optional[AssociationType] = None
    member_number: str
    status: Literal["professional", "non_pro", "general"]
    expires_at: Optional[date] = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def from_registration(cls, v):
        if isinstance(v, dict):
            return v
        association = getattr(v, 'association', None)
        return {
            'id': v.id,
            'trainer_id': v.trainer_id,
            'association_id': v.association_id,
            'association_code': association.code if association else '',
            'association_name': association.name if association else '',
            'association_type': association.association_type if association else None,
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
    # name is the registered (association) name; barn_name is the optional call name.
    name: str = Field(min_length=1, max_length=200)
    barn_name: Optional[str] = Field(default=None, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = Field(default=None, max_length=200)
    trainer_phone: Optional[str] = Field(default=None, max_length=30)
    trainer_first_name: Optional[str] = Field(default=None, max_length=100)
    trainer_last_name: Optional[str] = Field(default=None, max_length=100)
    trainer_email: Optional[EmailStr] = None
    sire_name: Optional[str] = Field(default=None, max_length=200)
    dam_name: Optional[str] = Field(default=None, max_length=200)
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    breed_ids: Optional[list[UUID]] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: bool = False

class HorseWithRegistrationsBase(HorseCreate):
    """A horse plus the association numbers to file with it, in one request, so
    a rejected number never leaves an orphaned horse behind. Who ends up owning
    it is left to the subclasses — that differs by who is filling the form in."""
    registrations: list[HorseRegistrationCreate] = Field(default_factory=list)


class HorseCreateWithRegistrations(HorseWithRegistrationsBase):
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
    barn_name: Optional[str] = Field(default=None, max_length=200)
    owner_exhibitor_id: Optional[UUID] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = Field(default=None, max_length=200)
    trainer_phone: Optional[str] = Field(default=None, max_length=30)
    trainer_first_name: Optional[str] = Field(default=None, max_length=100)
    trainer_last_name: Optional[str] = Field(default=None, max_length=100)
    trainer_email: Optional[EmailStr] = None
    sire_name: Optional[str] = Field(default=None, max_length=200)
    dam_name: Optional[str] = Field(default=None, max_length=200)
    foaling_date: Optional[date] = None
    sex: Optional[Literal["Mare", "Gelding", "Stallion"]] = None
    breed_id: Optional[UUID] = None
    breed_ids: Optional[list[UUID]] = None
    color_id: Optional[UUID] = None
    is_solid_paint_bred: Optional[bool] = None

def _horse_out_data(v) -> dict:
    """Shared ORM -> dict projection for HorseOut and its subclasses."""
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
        'barn_name': getattr(v, 'barn_name', None),
        'owner_exhibitor_id': v.owner_exhibitor_id,
        'owner_exhibitor_name': owner_exhibitor.full_name if owner_exhibitor else None,
        'created_by_exhibitor_id': getattr(v, 'created_by_exhibitor_id', None),
        'owner_name': getattr(v, 'owner_name', None),
        'trainer_id': getattr(v, 'trainer_id', None),
        # trainer_name is always the display name: registry takes precedence over free text
        'trainer_name': trainer.name if trainer else getattr(v, 'trainer_name', None),
        'sire_name': getattr(v, 'sire_name', None),
        'dam_name': getattr(v, 'dam_name', None),
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


class HorseOut(BaseModel):
    id: UUID
    name: str
    barn_name: Optional[str] = None
    owner_exhibitor_id: Optional[UUID] = None
    owner_exhibitor_name: Optional[str] = None
    created_by_exhibitor_id: Optional[UUID] = None
    owner_name: Optional[str] = None
    trainer_id: Optional[UUID] = None
    trainer_name: Optional[str] = None
    sire_name: Optional[str] = None
    dam_name: Optional[str] = None
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
        return _horse_out_data(v)

    class Config:
        from_attributes = True


class HorseRegistrationBrief(BaseModel):
    association_id: UUID
    association_code: str
    association_type: AssociationType
    registration_number: str


class HorseDocumentBrief(BaseModel):
    document_type: str
    document_type_label: str
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None


class MyHorseOut(HorseOut):
    """HorseOut plus what the exhibitor profile's horse list needs to show
    readiness at a glance: association numbers and a document summary.
    Both are only populated when the router eager-loads them."""
    registrations: list[HorseRegistrationBrief] = Field(default_factory=list)
    documents: list[HorseDocumentBrief] = Field(default_factory=list)

    @model_validator(mode='before')
    @classmethod
    def compute_derived(cls, v):
        if isinstance(v, dict):
            return v
        data = _horse_out_data(v)
        unloaded = sa_inspect(v).unloaded
        regs = [] if 'registrations' in unloaded else list(getattr(v, 'registrations', None) or [])
        data['registrations'] = [
            {
                'association_id': r.association_id,
                'association_code': r.association.code if r.association else '',
                'association_type': r.association.association_type if r.association else 'breed',
                'registration_number': r.registration_number,
            }
            for r in regs
        ]
        docs = [] if 'documents' in unloaded else list(getattr(v, 'documents', None) or [])
        data['documents'] = [
            {
                'document_type': d.document_type,
                'document_type_label': DOC_TYPE_LABELS.get(d.document_type, d.document_type),
                'issue_date': d.issue_date,
                'expiry_date': d.expiry_date,
            }
            for d in docs
        ]
        return data


class CreatedHorseResult(MyHorseOut):
    """The horse an exhibitor just filed, plus — when they filed it against
    somebody else's account — the request now waiting on that owner.

    A rider naming an owner who is already on the platform does not get the
    horse on their profile outright; the owner is asked first, the same way
    linking an existing horse is. `approval_url` is always returned alongside
    the emailed copy, because delivery is best-effort (see `mailer.py`) and a
    silent SMTP failure must not strand the horse.
    """
    pending_owner_approval: bool = False
    approval_url: Optional[str] = None
    approver_name: Optional[str] = None
    approval_email_sent: Optional[bool] = None


class HorseSearchMatch(BaseModel):
    """Result row for the name-based horse search used when an exhibitor wants
    to link a horse that is already in the system."""
    horse_id: UUID
    horse_name: str
    barn_name: Optional[str] = None
    owner_name: Optional[str] = None
    sex: Optional[str] = None
    breed_name: Optional[str] = None
    registrations: list[HorseRegistrationBrief] = Field(default_factory=list)


class HorseRiderOut(BaseModel):
    exhibitor_id: UUID
    full_name: str

class HorseRiderCreate(BaseModel):
    exhibitor_id: UUID


# ── Exhibitor Registrations ───────────────────────────────────────────────────

class ExhibitorRegistrationCreate(BaseModel):
    association_id: UUID
    member_number: str = Field(min_length=1, max_length=50)

class ExhibitorRegistrationOut(BaseModel):
    id: UUID
    association_id: UUID
    association_code: str
    association_name: str
    association_type: Optional[AssociationType] = None
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


class CogginsOverrideAuditOut(BaseModel):
    """A show-staff bypass of the Coggins entry gate (migration 082)."""

    id: UUID
    show_id: UUID
    entry_id: Optional[UUID]
    class_id: Optional[UUID]
    horse_id: Optional[UUID]
    horse_name: str
    # Which failure was bypassed: 'missing', 'undated', or 'expired'.
    coggins_status: str
    overridden_by: Optional[UUID]
    overridden_by_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Show office paperwork verification (migration 090) ─────────────────────────

VerificationKind = Literal[
    "horse_age",
    "horse_registration",
    "exhibitor_membership",
    # The office physically inspected a Coggins, CVI, or vaccination record
    # (migration 098). Keyed on the horse and the document type rather than
    # on an uploaded row, because the paper is often not in the app at all.
    "horse_health_document",
]

HealthDocumentType = Literal["COGGINS", "VACCINATION", "HEALTH_CERTIFICATE"]

# How a single check reads back to the office:
#   verified    — signed off, and the value on file still matches the sign-off.
#   stale       — signed off, but the value on file has changed since.
#   unverified  — a value is on file and nobody has checked it against paper.
#   not_on_file — nothing to check against; the record itself is missing.
VerificationStatus = Literal["verified", "stale", "unverified", "not_on_file"]


class ShowVerificationCreate(BaseModel):
    """What to sign off on. The value verified is never sent by the client —
    the backend reads it off the record so a caller cannot attest to a number
    that is not actually on file."""

    kind: VerificationKind
    horse_id: Optional[UUID] = None
    exhibitor_id: Optional[UUID] = None
    association_id: Optional[UUID] = None
    # Which paper was inspected, for horse_health_document only.
    document_type: Optional[HealthDocumentType] = None
    # The expiry printed on the document the office was handed. The one value in
    # this request the backend does not derive, because there is nothing to
    # derive it from when the paper was never uploaded. Optional — recording an
    # inspection of an illegible or lapsed document is still worth doing, and
    # leaves the horse flagged.
    attested_expiry: Optional[date] = None
    note: Optional[str] = Field(default=None, max_length=500)


class ShowVerificationOut(BaseModel):
    id: UUID
    show_id: UUID
    kind: VerificationKind
    horse_id: Optional[UUID]
    exhibitor_id: Optional[UUID]
    association_id: Optional[UUID]
    document_type: Optional[str] = None
    attested_expiry: Optional[date] = None
    verified_value: str
    note: Optional[str]
    verified_by: Optional[UUID]
    verified_by_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class VerificationCheckOut(BaseModel):
    """One line on the check-in sheet."""

    kind: VerificationKind
    status: VerificationStatus
    # What the profile says right now — the number or date staff hold the paper
    # against. None means nothing is on file (status is then not_on_file).
    current_value: Optional[str] = None
    association_id: Optional[UUID] = None
    association_code: Optional[str] = None
    association_name: Optional[str] = None
    # Populated once signed off; verified_value is what was on file at the time,
    # and differs from current_value exactly when the check has gone stale.
    verification_id: Optional[UUID] = None
    verified_value: Optional[str] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[datetime] = None
    note: Optional[str] = None


HealthStatus = Literal["valid", "missing", "undated", "expired"]


class HealthInspectionOut(BaseModel):
    """Whether the office physically looked at this horse's paper.

    Separate from the health status above because they answer different
    questions and can disagree in both directions. The file says whether the
    date is still good; only a person at the counter says whether the paper is
    genuine, present, and describes *this* horse. A current Coggins nobody has
    seen and a lapsed one the office has in its hand are different situations,
    and the desk needs to tell them apart.
    """

    # unverified — nobody has signed off.
    # verified   — signed off, and nothing has changed since.
    # stale      — signed off, but the documents on file have moved since.
    status: Literal["unverified", "verified", "stale"] = "unverified"
    verification_id: Optional[UUID] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[datetime] = None
    # What the expiry said on the paper staff were handed, when they recorded
    # it. This is what lets an inspection clear a flag rather than merely
    # noting that somebody looked.
    attested_expiry: Optional[date] = None
    note: Optional[str] = None


class HorseHealthCheckOut(BaseModel):
    """A horse's health paperwork standing at one show.

    Two facts on one line. `status` is derived from the documents on file and
    clears itself the moment a current one is uploaded — there is no row to
    remember to close. `inspection` is the office's sign-off that it saw the
    paper, which is a claim about a physical document and cannot be derived
    from anything.
    """

    code: str
    label: str
    status: HealthStatus
    message: str
    # The furthest-out expiry on file, so a screen can name the date it is
    # complaining about. None when nothing on file carries one.
    expiry_date: Optional[date] = None
    # True when this reads `valid` because the office inspected paper rather
    # than because a document is uploaded. Screens must not imply the app holds
    # a scan it has never been shown — and the next show, which has not seen
    # that paper, will flag the horse again.
    attested: bool = False
    # The show office's own words on what it requires — vaccinations only, and
    # only when the show filled it in.
    notes: Optional[str] = None
    # Absent on the exhibitor's own screens: whether staff have inspected the
    # paper is the office's business, and showing it would read as a second
    # thing the exhibitor has to do something about.
    inspection: Optional[HealthInspectionOut] = None


class VerificationHorseOut(BaseModel):
    horse_id: UUID
    horse_name: str
    barn_name: Optional[str] = None
    age_check: VerificationCheckOut
    registrations: list[VerificationCheckOut] = Field(default_factory=list)
    # Required health papers only — a show that does not ask for a CVI gets no
    # CVI line. The derived `status` on each is excluded from `outstanding`;
    # the `inspection` on each is counted, because that one is a sign-off the
    # desk still owes.
    health: list[HorseHealthCheckOut] = Field(default_factory=list)


class WaiverCheckOut(BaseModel):
    """One waiver, and whether this exhibitor has signed it.

    Not a `VerificationCheckOut`: there is no value to hold a signature against
    and nothing for it to go stale against. A signature is either there or it
    is not.
    """

    waiver_id: UUID
    title: str
    is_required: bool = True
    status: Literal["signed", "unsigned"] = "unsigned"
    signed_name: Optional[str] = None
    signed_at: Optional[datetime] = None
    # True when staff recorded a paper blank rather than the exhibitor typing.
    on_paper: bool = False
    signed_by_guardian: bool = False
    guardian_relationship: Optional[str] = None
    recorded_by_name: Optional[str] = None


class ExhibitorEmergencyContactUpdate(BaseModel):
    """A contact taken over the counter and written to the exhibitor's profile.

    Both halves or neither. A name with no number still reads as missing
    everywhere it is checked, so accepting one would let staff type something,
    press save, and watch the row go on saying "no emergency contact" — which
    reads as the save having failed. Sending both empty clears the contact.
    """

    name: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)


class EmergencyContactOut(BaseModel):
    """Who the show calls if something happens to this exhibitor.

    Read straight off the exhibitor profile (migration 041) rather than copied
    per show — a second copy would be a second, staler answer to the only
    question that matters here.
    """

    status: Literal["on_file", "missing"] = "missing"
    name: Optional[str] = None
    phone: Optional[str] = None


class VerificationExhibitorOut(BaseModel):
    exhibitor_id: UUID
    exhibitor_name: str
    back_number: Optional[int] = None
    # NULL registered_at is a shell row a secretary created while adding an
    # entry by hand — the person is on the roster but never self-signed up.
    signed_up: bool = False
    memberships: list[VerificationCheckOut] = Field(default_factory=list)
    horses: list[VerificationHorseOut] = Field(default_factory=list)
    waivers: list[WaiverCheckOut] = Field(default_factory=list)
    emergency_contact: EmergencyContactOut = Field(default_factory=EmergencyContactOut)
    outstanding: int = 0


class VerificationTotalsOut(BaseModel):
    checks: int = 0
    verified: int = 0
    stale: int = 0
    unverified: int = 0
    not_on_file: int = 0
    # Counted apart from the sign-offs above because they are different jobs
    # with different fixes: chasing a signature is not chasing a document.
    waivers_outstanding: int = 0
    contacts_missing: int = 0


class VerificationChecklistOut(BaseModel):
    show_id: UUID
    exhibitors: list[VerificationExhibitorOut] = Field(default_factory=list)
    totals: VerificationTotalsOut = Field(default_factory=VerificationTotalsOut)


# ── Health flags ───────────────────────────────────────────────────────────────
# Horses entered in a show whose health paperwork will not carry them through
# it. Entry does not depend on this — the flag exists so the office finds out
# while there is still time to do something about it.

class HealthFlagExhibitorOut(BaseModel):
    exhibitor_id: UUID
    exhibitor_name: str
    back_number: Optional[int] = None


class HealthFlagOut(BaseModel):
    horse_id: UUID
    horse_name: str
    barn_name: Optional[str] = None
    check: HorseHealthCheckOut
    entry_count: int = 0
    # A horse shared between exhibitors is one flag with both names on it —
    # it is one piece of paper, and chasing it twice would be chasing it twice.
    exhibitors: list[HealthFlagExhibitorOut] = Field(default_factory=list)


class HealthFlagTotalsOut(BaseModel):
    horses: int = 0
    flagged: int = 0
    missing: int = 0
    undated: int = 0
    expired: int = 0


class ShowHealthFlagsOut(BaseModel):
    show_id: UUID
    # The day the paperwork has to be good for — the show's last day.
    as_of: date
    flagged: list[HealthFlagOut] = Field(default_factory=list)
    totals: HealthFlagTotalsOut = Field(default_factory=HealthFlagTotalsOut)


# ── Waivers ────────────────────────────────────────────────────────────────────
# What a show asks exhibitors to sign, and who has signed it. Free text on the
# way in because the words come from the venue's insurer or the fair board.

class ShowWaiverCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)
    is_required: bool = True
    sort_order: int = Field(default=0, ge=0)


class ShowWaiverUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body: Optional[str] = Field(default=None, min_length=1, max_length=20000)
    is_required: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0)


class ShowWaiverOut(BaseModel):
    id: UUID
    show_id: UUID
    title: str
    body: str
    is_required: bool
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


class WaiverSignatureCreate(BaseModel):
    """A signature. `signed_name` is the one value here the app does not derive —
    a signature is a claim a person makes, not a fact already on file."""

    signed_name: str = Field(min_length=1, max_length=200)
    signed_by_guardian: bool = False
    guardian_relationship: Optional[str] = Field(default=None, max_length=100)


class StaffWaiverSignatureCreate(WaiverSignatureCreate):
    """Staff recording a paper blank handed in at the counter. Same fact, other
    route — `on_paper` is set by the endpoint, not by the caller."""


class WaiverSignatureOut(BaseModel):
    id: UUID
    waiver_id: UUID
    exhibitor_id: UUID
    signed_name: str
    signed_by_guardian: bool
    guardian_relationship: Optional[str] = None
    signed_at: datetime
    on_paper: bool
    recorded_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class ShowWaiverForExhibitorOut(ShowWaiverOut):
    """A waiver as the person being asked to sign it sees it."""

    signature: Optional[WaiverSignatureOut] = None


class StaffHorseCreate(HorseWithRegistrationsBase):
    """A horse created by show staff for an exhibitor standing at the desk.

    The owner is always the exhibitor named in the path. None of the
    owner-selection fields the self-service form uses are declared here, and the
    inherited `owner_exhibitor_id` is dropped by
    `people.build_horse_with_registrations` along with the rest of the owner
    resolution — so no request body can point the horse at somebody else.
    """


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
    # Which judge's card this came off — a `show_judges.id`, validated against
    # this show. Omitted means unattributed, which is what a show with no judges
    # assigned produces (migration 095).
    judge_id: Optional[UUID] = None

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
    """One judge's whole card for one class.

    `judge_id` sits on the envelope rather than on each item deliberately: the
    save replaces every row it owns, and the rows it owns are exactly "this
    class, this judge". Per-item judges would make the delete scope ambiguous
    and let one request wipe another judge's card.
    """
    results: list[ResultBulkItem]
    judge_id: Optional[UUID] = None

class ResultOut(BaseModel):
    id: UUID
    class_id: UUID
    entry_id: UUID
    judge_id: Optional[UUID] = None
    place: int
    raw_score: Optional[float] = None
    is_tie: bool
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Results Publish Gate ───────────────────────────────────────────────────────

class ClassResultsPublishOut(BaseModel):
    """Result of posting a class's placings to the public screens."""
    class_id: UUID
    results_published_at: datetime


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
# show. Exhibitors enter at the back-number (show_entry) level and pay a flat
# buy-in. The pot ranks its entries by combined score across the bundled classes
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
    # Being in the pot *is* owing the buy-in — pot money is settled with the
    # rest of the exhibitor's bill at the end of the show, not collected per
    # entry at the desk. So `paid` defaults to true and the UI no longer asks:
    # a pot whose entries all read unpaid has a $0 pool and pays out nothing.
    # The column and PATCH stay for pots that tracked it the old way.
    paid: bool = True

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


class SidePotRosterEntry(BaseModel):
    """One row of the show's roster, for the pot's exhibitor picker.

    A pot entry hangs off `show_entries`, so that — not the class entry list —
    is what the picker offers. Back number may be null: the roster exists before
    numbers are handed out, and standings read the number live, so someone added
    early picks theirs up as soon as it is assigned.
    """

    show_entry_id: UUID
    back_number: Optional[int] = None
    exhibitor_name: Optional[str] = None


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


# ── Financials ─────────────────────────────────────────────────────────────────
# What the show has billed, what the office recorded collecting, and what is
# still owed. The money itself is computed in `billing.py` — these types only
# describe the shape it comes back in.

PaymentMethod = Literal["cash", "check", "card", "transfer", "other"]


class ShowPaymentCreate(BaseModel):
    """Record a payment the office took. `recorded_by` is read from the caller's
    headers, never sent — the same reason a verification's value is not."""

    exhibitor_id: UUID
    # Signed: negative is a refund. Zero is rejected by the DB check and by the
    # validator below, since it is never a payment anyone needs a row for.
    amount_cents: int
    method: PaymentMethod
    reference: Optional[str] = Field(default=None, max_length=100)
    received_on: Optional[date] = None
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("amount_cents")
    @classmethod
    def _nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("A payment cannot be zero. Use a negative amount to record a refund.")
        return v


class ShowPaymentOut(BaseModel):
    id: UUID
    show_entry_id: UUID
    amount_cents: int
    method: PaymentMethod
    reference: Optional[str] = None
    received_on: date
    note: Optional[str] = None
    recorded_by: Optional[UUID] = None
    recorded_by_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BillClassLineOut(BaseModel):
    entry_id: UUID
    class_id: UUID
    class_number: int
    class_name: str
    class_date: Optional[date] = None
    horse_name: Optional[str] = None
    fee_cents: int
    nsba_sanction_cents: int


class BillReservationLineOut(BaseModel):
    show_fee_id: UUID
    code: str
    label: str
    unit: FeeUnit
    quantity: int
    # What this exhibitor is actually charged per unit, which is the early rate
    # when they booked before the deadline. `standard_amount_cents` is kept
    # alongside so the sheet can show what the early rate saved them.
    amount_cents: int
    standard_amount_cents: int
    is_early_rate: bool
    reserved_at: date
    line_total_cents: int


class BillOut(BaseModel):
    """One exhibitor's charges, straight from `billing.build_bill`."""

    class_lines: list[BillClassLineOut] = Field(default_factory=list)
    reservation_lines: list[BillReservationLineOut] = Field(default_factory=list)
    class_fee_total_cents: int
    nsba_sanction_total_cents: int
    office_charge_cents: int
    office_charge_basis: str
    office_charge_total_cents: int
    reservation_total_cents: int
    total_cents: int


class FinancialAccountOut(BaseModel):
    """One exhibitor's account at this show: billed, paid, and the difference."""

    exhibitor_id: UUID
    exhibitor_name: str
    show_entry_id: Optional[UUID] = None
    back_number: Optional[int] = None
    # False for the shell `show_entries` row a secretary creates when adding a
    # late entry by hand. Those accounts still owe money, so they belong here —
    # but the office reads them differently from a completed sign-up.
    signed_up: bool = False
    registered_at: Optional[datetime] = None
    entry_count: int = 0
    horse_count: int = 0
    bill: BillOut
    collected_cents: int = 0
    refunded_cents: int = 0
    net_paid_cents: int = 0
    # Positive means they owe the show; negative means they have overpaid.
    balance_cents: int = 0
    payments: list[ShowPaymentOut] = Field(default_factory=list)


class FinancialFeeLineOut(BaseModel):
    """How many of one fee the show sold, and for how much."""

    show_fee_id: UUID
    code: str
    label: str
    unit: FeeUnit
    quantity: int
    line_total_cents: int
    early_rate_quantity: int = 0


class FinancialTotalsOut(BaseModel):
    accounts: int = 0
    class_fee_total_cents: int = 0
    nsba_sanction_total_cents: int = 0
    office_charge_total_cents: int = 0
    reservation_total_cents: int = 0
    billed_cents: int = 0
    collected_cents: int = 0
    refunded_cents: int = 0
    net_paid_cents: int = 0
    # Outstanding is the sum of what is owed, ignoring overpayments; credit is
    # the sum of the overpayments. Kept apart so one exhibitor paying twice
    # cannot make the show's arrears look smaller than they are.
    outstanding_cents: int = 0
    credit_cents: int = 0
    net_balance_cents: int = 0
    accounts_outstanding: int = 0
    accounts_paid_in_full: int = 0
    accounts_unpaid: int = 0
    fee_lines: list[FinancialFeeLineOut] = Field(default_factory=list)


class FinancialRegistrationsOut(BaseModel):
    """The registration counts behind the money."""

    exhibitors: int = 0
    signed_up: int = 0
    # Roster rows with no completed sign-up — the shells a secretary creates
    # while entering someone by hand.
    staff_added: int = 0
    entries: int = 0
    horses: int = 0
    classes: int = 0
    classes_with_entries: int = 0


class FinancialSidePotOut(BaseModel):
    side_pot_id: UUID
    name: str
    status: SidePotStatus
    entry_fee_cents: int
    payback_percent: int
    entry_count: int = 0
    paid_count: int = 0
    buy_ins_cents: int = 0
    payout_pool_cents: int = 0
    paid_out_cents: int = 0
    retained_cents: int = 0


class ShowFinancialsOut(BaseModel):
    """The Financials overview for one show.

    Side pot money is reported separately and is deliberately not folded into
    any account balance — pot buy-ins are not part of `build_bill`, and adding
    them here would make this screen disagree with the bill the exhibitor sees
    on My Shows.
    """

    show_id: UUID
    show_name: str
    show_status: str
    currency: str = "USD"
    # `per_back_number` or `per_horse` — what the office charge is multiplied by,
    # so the screen can label the line without guessing.
    office_charge_basis: str = "per_back_number"
    totals: FinancialTotalsOut = Field(default_factory=FinancialTotalsOut)
    registrations: FinancialRegistrationsOut = Field(default_factory=FinancialRegistrationsOut)
    accounts: list[FinancialAccountOut] = Field(default_factory=list)
    side_pots: list[FinancialSidePotOut] = Field(default_factory=list)
    side_pot_buy_ins_cents: int = 0
    side_pot_paid_out_cents: int = 0
    side_pot_retained_cents: int = 0


# ── Financial reports ──────────────────────────────────────────────────────────
# A small registry rather than an endpoint per report: a report is a title, a
# column list, and rows of already-formatted cells, so the frontend renders any
# of them — including ones added later — without a new page.

ReportCellAlign = Literal["left", "right"]


class ReportColumnOut(BaseModel):
    key: str
    label: str
    align: ReportCellAlign = "left"
    # Marks the column as money so the renderer can total or emphasize it.
    is_money: bool = False


class ReportDefinitionOut(BaseModel):
    slug: str
    title: str
    description: str


class ReportOut(BaseModel):
    slug: str
    title: str
    description: str
    show_id: UUID
    show_name: str
    generated_at: datetime
    columns: list[ReportColumnOut] = Field(default_factory=list)
    # Cell values are strings or numbers; money arrives as integer cents and is
    # formatted by the renderer so every report formats money the same way.
    rows: list[dict[str, Any]] = Field(default_factory=list)
    # Column key → cents, rendered as a footer row when present.
    totals: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


# ── Registration desk ──────────────────────────────────────────────────────────
# One exhibitor's whole standing at one show: their number, their classes, their
# side pots, their paperwork, and what they owe. The desk screen does all of that
# in one conversation, so it reads it in one payload — see `routers/show_desk.py`
# for why none of these figures are computed there.


class ShowDeskClassOut(BaseModel):
    """A class as the desk's entry picker needs it."""

    id: UUID
    class_number: str
    class_name: str
    class_date: date
    status: str
    score_type: str
    entry_fee_cents: int = 0
    # Riding style and age/skill bracket — the two axes the picker groups by.
    discipline_name: Optional[str] = None
    division_name: Optional[str] = None
    entry_count: int = 0


class ShowDeskSidePotOut(BaseModel):
    id: UUID
    name: str
    # Surfaced as the buy-in: it is not the class fee and must not read as one.
    entry_fee_cents: int = 0
    status: str
    entry_count: int = 0


class ShowDeskEntryOut(BaseModel):
    entry_id: UUID
    class_id: UUID
    class_number: Optional[str] = None
    class_name: Optional[str] = None
    class_date: Optional[date] = None
    # Deleting a horse nulls entries.horse_id to preserve the entry history, so
    # an entry with no horse is expected rather than a broken row.
    horse_id: Optional[UUID] = None
    horse_name: Optional[str] = None
    barn_name: Optional[str] = None
    # The program columns. A linked owner exhibitor wins over the free-text
    # `horses.owner_name`, matching the public class schedule.
    owner_name: Optional[str] = None
    sire_name: Optional[str] = None
    dam_name: Optional[str] = None
    apha_division: Optional[str] = None
    is_disqualified: bool = False


class ShowDeskExhibitorOut(BaseModel):
    exhibitor_id: UUID
    exhibitor_name: str
    # NULL until the exhibitor has a `show_entries` row. A back number and a
    # side pot entry both hang off that row, which is why the desk creates one
    # before offering either.
    show_entry_id: Optional[UUID] = None
    back_number: Optional[int] = None
    signed_up: bool = False
    entries: list[ShowDeskEntryOut] = Field(default_factory=list)
    side_pot_ids: list[UUID] = Field(default_factory=list)
    # The same check rows the standalone check-in sheet renders, from the same
    # builder — "verified", "changed since sign-off", and "nothing on file" have
    # one definition and it lives in `show_office.py`.
    memberships: list[VerificationCheckOut] = Field(default_factory=list)
    horses: list[VerificationHorseOut] = Field(default_factory=list)
    waivers: list[WaiverCheckOut] = Field(default_factory=list)
    emergency_contact: EmergencyContactOut = Field(default_factory=EmergencyContactOut)
    paperwork_outstanding: int = 0
    # From `build_account`, never re-derived: the running total the desk reads
    # out has to match the bill the exhibitor sees on My Shows.
    billed_cents: int = 0
    net_paid_cents: int = 0
    balance_cents: int = 0


class ShowDeskTotalsOut(BaseModel):
    exhibitors: int = 0
    entries: int = 0
    classes: int = 0
    no_back_number: int = 0
    no_entries: int = 0
    paperwork_outstanding: int = 0
    health_alerts: int = 0
    waivers_outstanding: int = 0
    contacts_missing: int = 0


class ShowDeskOut(BaseModel):
    show_id: UUID
    show_name: str
    show_status: str
    show_type_code: Optional[str] = None
    classes: list[ShowDeskClassOut] = Field(default_factory=list)
    side_pots: list[ShowDeskSidePotOut] = Field(default_factory=list)
    exhibitors: list[ShowDeskExhibitorOut] = Field(default_factory=list)
    totals: ShowDeskTotalsOut = Field(default_factory=ShowDeskTotalsOut)


class ShowDeskExhibitorAdd(BaseModel):
    exhibitor_id: UUID


class ShowDeskRosterRow(BaseModel):
    show_entry_id: UUID
    exhibitor_id: UUID
    exhibitor_name: str
    back_number: Optional[int] = None
    signed_up: bool = False
