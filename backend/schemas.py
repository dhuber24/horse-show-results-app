"""
Pydantic schemas for Horse Show Results App
Matches the actual database schema
Used for request validation and response serialization
"""

from pydantic import BaseModel, Field, EmailStr, validator
from datetime import datetime, date
from typing import Optional, List
from enum import Enum
from uuid import UUID


# ============================================================================
# Enums
# ============================================================================

class UserRole(str, Enum):
    """User roles in the system"""
    ADMIN = "ADMIN"
    SCOREKEEPER = "SCOREKEEPER"
    EXHIBITOR = "EXHIBITOR"


class ShowStatus(str, Enum):
    """Show lifecycle status"""
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class ClassStatus(str, Enum):
    """Class status"""
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class EntryStatus(str, Enum):
    """Entry status"""
    ENTERED = "ENTERED"
    WITHDRAWN = "WITHDRAWN"
    DISQUALIFIED = "DISQUALIFIED"


# ============================================================================
# Authentication Schemas
# ============================================================================

class LoginRequest(BaseModel):
    """Request for user login"""
    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginResponse(BaseModel):
    """Response from login endpoint"""
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserResponse"

    class Config:
        from_attributes = True


# ============================================================================
# Venue Schemas
# ============================================================================

class VenueBase(BaseModel):
    """Base venue schema"""
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=2)


class VenueCreate(VenueBase):
    """Schema for creating a venue"""
    pass


class VenueUpdate(BaseModel):
    """Schema for updating a venue"""
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None


class VenueResponse(VenueBase):
    """Schema for venue in responses"""
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Show Schemas
# ============================================================================

class ShowBase(BaseModel):
    """Base show schema"""
    name: str = Field(..., min_length=1, max_length=255)
    venue_id: Optional[UUID] = None
    start_date: date
    end_date: date
    status: ShowStatus = ShowStatus.DRAFT


class ShowCreate(ShowBase):
    """Schema for creating a show"""
    pass


class ShowUpdate(BaseModel):
    """Schema for updating a show"""
    name: Optional[str] = None
    venue_id: Optional[UUID] = None
    status: Optional[ShowStatus] = None


class ShowResponse(ShowBase):
    """Schema for show in responses"""
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ShowDetailResponse(ShowResponse):
    """Detailed show response with related resources"""
    venue: Optional[VenueResponse] = None
    rings: List["RingResponse"] = []
    divisions: List["DivisionResponse"] = []
    classes: List["ClassResponse"] = []


# ============================================================================
# Ring Schemas
# ============================================================================

class RingBase(BaseModel):
    """Base ring schema"""
    name: str = Field(..., min_length=1, max_length=255)


class RingCreate(RingBase):
    """Schema for creating a ring"""
    pass


class RingUpdate(BaseModel):
    """Schema for updating a ring"""
    name: Optional[str] = None


class RingResponse(RingBase):
    """Schema for ring in responses"""
    id: UUID
    show_id: UUID

    class Config:
        from_attributes = True


# ============================================================================
# Division Schemas
# ============================================================================

class DivisionBase(BaseModel):
    """Base division schema"""
    name: str = Field(..., min_length=1, max_length=255)


class DivisionCreate(DivisionBase):
    """Schema for creating a division"""
    pass


class DivisionUpdate(BaseModel):
    """Schema for updating a division"""
    name: Optional[str] = None


class DivisionResponse(DivisionBase):
    """Schema for division in responses"""
    id: UUID
    show_id: UUID

    class Config:
        from_attributes = True


# ============================================================================
# Class Schemas
# ============================================================================

class ClassBase(BaseModel):
    """Base class schema"""
    class_number: str = Field(..., min_length=1, max_length=50)
    class_name: str = Field(..., min_length=1, max_length=255)
    class_date: date
    status: ClassStatus = ClassStatus.OPEN
    ring_id: Optional[UUID] = None
    division_id: Optional[UUID] = None


class ClassCreate(ClassBase):
    """Schema for creating a class"""
    pass


class ClassUpdate(BaseModel):
    """Schema for updating a class"""
    class_name: Optional[str] = None
    class_date: Optional[date] = None
    status: Optional[ClassStatus] = None
    ring_id: Optional[UUID] = None
    division_id: Optional[UUID] = None


class ClassResponse(ClassBase):
    """Schema for class in responses"""
    id: UUID
    show_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ClassDetailResponse(ClassResponse):
    """Detailed class response with entries and results"""
    entries: List["EntryResponse"] = []
    results: List["ResultResponse"] = []


# ============================================================================
# Horse Schemas
# ============================================================================

class HorseBase(BaseModel):
    """Base horse schema"""
    name: str = Field(..., min_length=1, max_length=255)
    owner_name: Optional[str] = Field(None, max_length=255)


class HorseCreate(HorseBase):
    """Schema for creating a horse"""
    pass


class HorseUpdate(BaseModel):
    """Schema for updating a horse"""
    name: Optional[str] = None
    owner_name: Optional[str] = None


class HorseResponse(HorseBase):
    """Schema for horse in responses"""
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class HorseDetailResponse(HorseResponse):
    """Detailed horse response with exhibitors"""
    exhibitors: List["ExhibitorResponse"] = []


# ============================================================================
# Exhibitor Schemas
# ============================================================================

class ExhibitorBase(BaseModel):
    """Base exhibitor schema"""
    full_name: str = Field(..., min_length=1, max_length=255)
    user_id: Optional[UUID] = None


class ExhibitorCreate(ExhibitorBase):
    """Schema for creating an exhibitor"""
    pass


class ExhibitorUpdate(BaseModel):
    """Schema for updating an exhibitor"""
    full_name: Optional[str] = None
    user_id: Optional[UUID] = None


class ExhibitorResponse(ExhibitorBase):
    """Schema for exhibitor in responses"""
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ExhibitorDetailResponse(ExhibitorResponse):
    """Detailed exhibitor response with horses and entries"""
    horses: List[HorseResponse] = []
    show_entries: List["ShowEntryResponse"] = []


# ============================================================================
# Exhibitor Horses Schemas
# ============================================================================

class ExhibitorHorseCreate(BaseModel):
    """Schema for linking horse to exhibitor"""
    horse_id: UUID


class ExhibitorHorseResponse(BaseModel):
    """Schema for exhibitor-horse relationship"""
    id: UUID
    exhibitor_id: UUID
    horse_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Show Entry Schemas
# ============================================================================

class ShowEntryCreate(BaseModel):
    """Schema for registering exhibitor for a show"""
    back_number: Optional[int] = Field(None, ge=1)


class ShowEntryUpdate(BaseModel):
    """Schema for updating show entry"""
    back_number: Optional[int] = Field(None, ge=1)


class ShowEntryResponse(BaseModel):
    """Schema for show entry in responses"""
    id: UUID
    show_id: UUID
    exhibitor_id: UUID
    exhibitor_name: Optional[str] = None
    back_number: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Entry Schemas
# ============================================================================

class EntryCreate(BaseModel):
    """Schema for entering exhibitor and horse into a class"""
    exhibitor_id: UUID
    horse_id: UUID
    back_number: Optional[int] = Field(None, ge=1)


class EntryUpdate(BaseModel):
    """Schema for updating an entry"""
    status: Optional[EntryStatus] = None
    back_number: Optional[int] = Field(None, ge=1)


class EntryResponse(BaseModel):
    """Schema for entry in responses"""
    id: UUID
    class_id: UUID
    exhibitor_id: UUID
    exhibitor_name: Optional[str] = None
    horse_id: UUID
    horse_name: Optional[str] = None
    back_number: Optional[int] = None
    status: EntryStatus
    created_at: datetime

    class Config:
        from_attributes = True


class EntryDetailResponse(EntryResponse):
    """Detailed entry response with result if exists"""
    result: Optional["ResultResponse"] = None


# ============================================================================
# Result Schemas
# ============================================================================

class ResultCreate(BaseModel):
    """Schema for creating a result (placing)"""
    entry_id: UUID
    place: int = Field(..., gt=0)
    is_tie: bool = False
    notes: Optional[str] = Field(None, max_length=500)


class ResultUpdate(BaseModel):
    """Schema for updating a result"""
    place: Optional[int] = Field(None, gt=0)
    is_tie: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=500)


class ResultResponse(BaseModel):
    """Schema for result in responses"""
    id: UUID
    class_id: UUID
    entry_id: UUID
    exhibitor_name: Optional[str] = None
    horse_name: Optional[str] = None
    back_number: Optional[int] = None
    place: int
    is_tie: bool
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ResultDetailResponse(ResultResponse):
    """Detailed result response with audit history"""
    audit_history: List["ResultAuditResponse"] = []


# ============================================================================
# Result Audit Schemas
# ============================================================================

class ResultAuditResponse(BaseModel):
    """Schema for result audit entry"""
    id: UUID
    result_id: UUID
    changed_by: Optional[str] = None  # User full name
    old_place: Optional[int] = None
    new_place: Optional[int] = None
    changed_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# User Schemas
# ============================================================================

class UserCreate(BaseModel):
    """Schema for creating a user"""
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=8)
    role: UserRole


class UserUpdate(BaseModel):
    """Schema for updating a user"""
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[UserRole] = None


class UserResponse(BaseModel):
    """Schema for user in responses"""
    id: UUID
    email: str
    full_name: str
    role: UserRole
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# List Response Schemas (Pagination)
# ============================================================================

class VenueListResponse(BaseModel):
    """Response for listing venues"""
    venues: List[VenueResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ShowListResponse(BaseModel):
    """Response for listing shows"""
    shows: List[ShowResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ClassListResponse(BaseModel):
    """Response for listing classes"""
    classes: List[ClassResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class HorseListResponse(BaseModel):
    """Response for listing horses"""
    horses: List[HorseResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ExhibitorListResponse(BaseModel):
    """Response for listing exhibitors"""
    exhibitors: List[ExhibitorResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class EntryListResponse(BaseModel):
    """Response for listing entries"""
    entries: List[EntryResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ResultListResponse(BaseModel):
    """Response for listing results"""
    results: List[ResultResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class RingListResponse(BaseModel):
    """Response for listing rings"""
    rings: List[RingResponse]


class DivisionListResponse(BaseModel):
    """Response for listing divisions"""
    divisions: List[DivisionResponse]


class UserListResponse(BaseModel):
    """Response for listing users"""
    users: List[UserResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ShowEntryListResponse(BaseModel):
    """Response for listing show entries"""
    entries: List[ShowEntryResponse]
    total: Optional[int] = None
    page: Optional[int] = None
    limit: Optional[int] = None


# ============================================================================
# Error Schemas
# ============================================================================

class ErrorResponse(BaseModel):
    """Error response schema"""
    detail: str
    errors: Optional[dict] = None

    class Config:
        json_schema_extra = {
            "example": {
                "detail": "Invalid request",
                "errors": {
                    "email": "Invalid email format"
                }
            }
        }


# ============================================================================
# Update forward references for circular dependencies
# ============================================================================

ShowDetailResponse.update_forward_refs()
ClassDetailResponse.update_forward_refs()
HorseDetailResponse.update_forward_refs()
ExhibitorDetailResponse.update_forward_refs()
EntryDetailResponse.update_forward_refs()
ResultDetailResponse.update_forward_refs()
