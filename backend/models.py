import uuid
from datetime import date, datetime
from sqlalchemy import (
    Column, Text, Date, Boolean, Integer, LargeBinary, ForeignKey,
    TIMESTAMP, UniqueConstraint, CheckConstraint, Numeric, func
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from database import Base


class ShowType(Base):
    __tablename__ = "show_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(Text, nullable=False, unique=True)
    name = Column(Text, nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    shows = relationship("Show", back_populates="show_type")


class Venue(Base):
    __tablename__ = "venues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    address = Column(Text)
    city = Column(Text)
    state = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    shows = relationship("Show", back_populates="venue_rel")
    venue_admins = relationship("VenueAdmin", back_populates="venue", cascade="all, delete")


class Show(Base):
    __tablename__ = "shows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=True)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(Text, nullable=False, default="DRAFT")
    apha_show_number = Column(Text, nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    venue_rel = relationship("Venue", back_populates="shows")
    show_type = relationship("ShowType", back_populates="shows")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    affiliations = relationship("ShowAffiliation", back_populates="show", cascade="all, delete", lazy="selectin")
    rings = relationship("Ring", back_populates="show", cascade="all, delete")
    divisions = relationship("Division", back_populates="show", cascade="all, delete")
    classes = relationship("Class", back_populates="show", cascade="all, delete")
    show_secretaries = relationship("ShowSecretary", back_populates="show", cascade="all, delete")
    show_scorekeepers = relationship("ShowScorekeeper", back_populates="show", cascade="all, delete")
    show_managers = relationship("ShowManager", back_populates="show", cascade="all, delete")
    show_entries = relationship("ShowEntry", back_populates="show", cascade="all, delete")
    side_pots = relationship("SidePot", back_populates="show", cascade="all, delete")


class ShowAffiliation(Base):
    """Secondary affiliations offered in some classes of a show."""
    __tablename__ = "show_affiliations"

    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), primary_key=True)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), primary_key=True)

    show = relationship("Show", back_populates="affiliations")
    show_type = relationship("ShowType", lazy="selectin")


class Ring(Base):
    __tablename__ = "rings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=True)

    show = relationship("Show", back_populates="rings")
    classes = relationship("Class", back_populates="ring")


class Division(Base):
    __tablename__ = "divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=True)

    show = relationship("Show", back_populates="divisions")
    classes = relationship("Class", back_populates="division")


class StandardRing(Base):
    __tablename__ = "standard_rings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)


class StandardDivision(Base):
    __tablename__ = "standard_divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=True)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)


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
    score_type = Column(Text, nullable=False, server_default="placement")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="classes")
    ring = relationship("Ring", back_populates="classes")
    division = relationship("Division", back_populates="classes")
    sort_order = Column(Integer, nullable=True)

    entries = relationship("Entry", back_populates="class_", cascade="all, delete")
    results = relationship("Result", back_populates="class_", cascade="all, delete")
    associations = relationship(
        "ClassAssociation",
        back_populates="class_",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    side_pot_classes = relationship(
        "SidePotClass", back_populates="class_", cascade="all, delete-orphan"
    )


class ClassAssociation(Base):
    __tablename__ = "class_associations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    association_class_code = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("class_id", "show_type_id"),)

    class_ = relationship("Class", back_populates="associations")
    show_type = relationship("ShowType", lazy="selectin")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role = Column(Text, nullable=False)
    full_name = Column(Text, nullable=False)
    email = Column(Text, unique=True, nullable=False)
    hashed_password = Column(Text, nullable=True)
    last_login_at = Column(TIMESTAMP(timezone=True), nullable=True)
    is_approved = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    audits = relationship("ResultAudit", back_populates="changed_by_user")
    exhibitor = relationship("Exhibitor", back_populates="user", uselist=False)
    secretary_shows = relationship("ShowSecretary", back_populates="user", cascade="all, delete")
    scorekeeper_shows = relationship("ShowScorekeeper", back_populates="user", cascade="all, delete")
    manager_shows = relationship("ShowManager", back_populates="user", cascade="all, delete")
    admin_venues = relationship("VenueAdmin", back_populates="user", cascade="all, delete")
    secretary_certifications = relationship("ShowSecretaryCertification", back_populates="user", cascade="all, delete")
    show_requests = relationship("ShowRequest", back_populates="requested_by", cascade="all, delete")


class VenueAdmin(Base):
    __tablename__ = "venue_admins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("venue_id", "user_id"),)

    venue = relationship("Venue", back_populates="venue_admins")
    user = relationship("User", back_populates="admin_venues")


class ShowSecretary(Base):
    __tablename__ = "show_secretaries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "user_id"),)

    show = relationship("Show", back_populates="show_secretaries")
    user = relationship("User", back_populates="secretary_shows")


class ShowScorekeeper(Base):
    __tablename__ = "show_scorekeepers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "user_id"),)

    show = relationship("Show", back_populates="show_scorekeepers")
    user = relationship("User", back_populates="scorekeeper_shows")


class Breed(Base):
    __tablename__ = "breeds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horses = relationship("Horse", back_populates="breed")


class HorseColor(Base):
    __tablename__ = "horse_colors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horses = relationship("Horse", back_populates="color")


class Horse(Base):
    __tablename__ = "horses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    owner_exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=True)
    created_by_exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=True)
    owner_name = Column(Text, nullable=True)
    trainer_name = Column(Text, nullable=True)
    foaling_date = Column(Date, nullable=True)
    sex = Column(Text, CheckConstraint("sex IN ('Mare', 'Gelding', 'Stallion')"), nullable=True)
    breed_id = Column(UUID(as_uuid=True), ForeignKey("breeds.id"), nullable=True)
    color_id = Column(UUID(as_uuid=True), ForeignKey("horse_colors.id"), nullable=True)
    is_solid_paint_bred = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    entries = relationship("Entry", back_populates="horse", passive_deletes=True)
    exhibitor_horses = relationship("ExhibitorHorse", back_populates="horse", cascade="all, delete")
    breed = relationship("Breed", back_populates="horses")
    color = relationship("HorseColor", back_populates="horses")
    registrations = relationship("HorseRegistration", back_populates="horse", cascade="all, delete")
    documents = relationship("HorseDocument", back_populates="horse", cascade="all, delete")
    owner_exhibitor = relationship("Exhibitor", foreign_keys=[owner_exhibitor_id])
    created_by_exhibitor = relationship("Exhibitor", foreign_keys=[created_by_exhibitor_id])


class Exhibitor(Base):
    __tablename__ = "exhibitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    full_name = Column(Text, nullable=False)
    apha_member_number = Column(Text, nullable=True)
    apha_member_expiry = Column(Date, nullable=True)
    amateur_card_number = Column(Text, nullable=True)
    amateur_card_expiry = Column(Date, nullable=True)
    amateur_novice_codes = Column(Text, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="exhibitor")
    entries = relationship("Entry", back_populates="exhibitor")
    exhibitor_horses = relationship("ExhibitorHorse", back_populates="exhibitor", cascade="all, delete")
    registrations = relationship("ExhibitorRegistration", back_populates="exhibitor", cascade="all, delete")
    documents = relationship("ExhibitorDocument", back_populates="exhibitor", cascade="all, delete")


class ExhibitorHorse(Base):
    __tablename__ = "exhibitor_horses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=False)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("exhibitor_id", "horse_id"),)

    exhibitor = relationship("Exhibitor", back_populates="exhibitor_horses")
    horse = relationship("Horse", back_populates="exhibitor_horses")


class ExhibitorRegistration(Base):
    __tablename__ = "exhibitor_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    member_number = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("exhibitor_id", "show_type_id"),)

    exhibitor = relationship("Exhibitor", back_populates="registrations")
    show_type = relationship("ShowType")


class HorseRegistration(Base):
    __tablename__ = "horse_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    registration_number = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("horse_id", "show_type_id"),
        UniqueConstraint("show_type_id", "registration_number", name="uq_horse_registrations_show_type_number"),
    )

    horse = relationship("Horse", back_populates="registrations")
    show_type = relationship("ShowType")


class HorseDocument(Base):
    __tablename__ = "horse_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=False)
    document_type = Column(
        Text,
        CheckConstraint("document_type IN ('COGGINS','VACCINATION','HEALTH_CERTIFICATE','REGISTRATION')"),
        nullable=False,
    )
    original_filename = Column(Text, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    mime_type = Column(Text, nullable=False)
    file_size = Column(Integer, nullable=False)
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horse = relationship("Horse", back_populates="documents")
    uploaded_by = relationship("User")


class ExhibitorDocument(Base):
    __tablename__ = "exhibitor_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=False)
    document_type = Column(
        Text,
        CheckConstraint("document_type IN ('MEMBERSHIP_CARD','AMATEUR_CARD','YOUTH_CARD','MEDICAL','IDENTIFICATION','OTHER')"),
        nullable=False,
    )
    original_filename = Column(Text, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    mime_type = Column(Text, nullable=False)
    file_size = Column(Integer, nullable=False)
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    exhibitor = relationship("Exhibitor", back_populates="documents")
    uploaded_by = relationship("User")


class Entry(Base):
    __tablename__ = "entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=False)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="SET NULL"), nullable=True)
    back_number = Column(Integer)
    status = Column(Text, nullable=False, default="ENTERED")
    apha_division = Column(Text, nullable=True)
    relationship_to_owner = Column(Text, nullable=True)
    is_disqualified = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("class_id", "exhibitor_id", "horse_id"),
        CheckConstraint(
            "apha_division IN ('OPEN','SOLID_PAINT_BRED','AMATEUR','NOVICE_AMATEUR','YOUTH','NOVICE_YOUTH')",
            name="ck_entries_apha_division",
        ),
    )

    class_ = relationship("Class", back_populates="entries")
    exhibitor = relationship("Exhibitor", back_populates="entries")
    horse = relationship("Horse", back_populates="entries")
    result = relationship("Result", back_populates="entry", uselist=False)


class Result(Base):
    __tablename__ = "results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    place = Column(Integer, nullable=False)
    raw_score = Column(Numeric(10, 3), nullable=True)
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
    result_id = Column(UUID(as_uuid=True), ForeignKey("results.id", ondelete="CASCADE"), nullable=True)
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
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=False)
    back_number = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("show_id", "exhibitor_id"),
        UniqueConstraint("show_id", "back_number"),
    )

    show = relationship("Show", back_populates="show_entries")
    exhibitor = relationship("Exhibitor")
    side_pot_entries = relationship(
        "SidePotEntry", back_populates="show_entry", cascade="all, delete-orphan"
    )
    side_pot_payouts = relationship(
        "SidePotPayout", back_populates="show_entry", cascade="all, delete-orphan"
    )


class ShowSecretaryCertification(Base):
    __tablename__ = "show_secretary_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    secretary_id_number = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("user_id", "show_type_id"),)

    user = relationship("User", back_populates="secretary_certifications")
    show_type = relationship("ShowType")


class CertOrgUser(Base):
    __tablename__ = "cert_org_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    state_province = Column(Text, nullable=True)
    country = Column(Text, nullable=True)
    completion_date = Column(Date, nullable=True)
    expiration = Column(Date, nullable=True)
    org = Column('Org', Text, nullable=True)


class ShowManager(Base):
    __tablename__ = "show_managers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "user_id"),)

    show = relationship("Show", back_populates="show_managers")
    user = relationship("User", back_populates="manager_shows")


class AphaStandardClass(Base):
    __tablename__ = "apha_standard_classes"

    code = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    division = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)


class ShowRequest(Base):
    __tablename__ = "show_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requested_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    show_name = Column(Text, nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id"), nullable=False)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="SET NULL"), nullable=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    manager_association_id = Column(Text, nullable=True)
    association_approval_confirmed = Column(Boolean, nullable=False, server_default="false")
    notes = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="PENDING")
    admin_notes = Column(Text, nullable=True)
    created_show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    requested_by = relationship("User", back_populates="show_requests")
    show_type = relationship("ShowType")
    venue = relationship("Venue")


class SidePot(Base):
    __tablename__ = "side_pots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    entry_fee_cents = Column(Integer, nullable=False, server_default="1000")
    payback_percent = Column(Integer, nullable=False, server_default="100")
    scoring_method = Column(Text, nullable=False, server_default="sum_placings")
    eligibility_rule = Column(Text, nullable=False, server_default="all_classes")
    payout_schedule = Column(JSONB, nullable=False)
    status = Column(Text, nullable=False, server_default="open")
    settled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "scoring_method IN ('sum_placings','sum_scores')",
            name="ck_side_pots_scoring_method",
        ),
        CheckConstraint(
            "eligibility_rule IN ('all_classes','any_class')",
            name="ck_side_pots_eligibility_rule",
        ),
        CheckConstraint(
            "status IN ('open','closed','settled')",
            name="ck_side_pots_status",
        ),
        CheckConstraint("entry_fee_cents >= 0", name="ck_side_pots_entry_fee_nonneg"),
        CheckConstraint(
            "payback_percent BETWEEN 0 AND 100",
            name="ck_side_pots_payback_range",
        ),
    )

    show = relationship("Show", back_populates="side_pots")
    pot_classes = relationship(
        "SidePotClass",
        back_populates="side_pot",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    pot_entries = relationship(
        "SidePotEntry",
        back_populates="side_pot",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    payouts = relationship(
        "SidePotPayout",
        back_populates="side_pot",
        cascade="all, delete-orphan",
    )


class SidePotClass(Base):
    __tablename__ = "side_pot_classes"

    side_pot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("side_pots.id", ondelete="CASCADE"),
        primary_key=True,
    )
    class_id = Column(
        UUID(as_uuid=True),
        ForeignKey("classes.id", ondelete="CASCADE"),
        primary_key=True,
    )

    side_pot = relationship("SidePot", back_populates="pot_classes")
    class_ = relationship("Class", back_populates="side_pot_classes")


class SidePotEntry(Base):
    __tablename__ = "side_pot_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    side_pot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("side_pots.id", ondelete="CASCADE"),
        nullable=False,
    )
    show_entry_id = Column(
        UUID(as_uuid=True),
        ForeignKey("show_entries.id", ondelete="CASCADE"),
        nullable=False,
    )
    paid = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("side_pot_id", "show_entry_id"),)

    side_pot = relationship("SidePot", back_populates="pot_entries")
    show_entry = relationship("ShowEntry", back_populates="side_pot_entries")


class SidePotPayout(Base):
    __tablename__ = "side_pot_payouts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    side_pot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("side_pots.id", ondelete="CASCADE"),
        nullable=False,
    )
    show_entry_id = Column(
        UUID(as_uuid=True),
        ForeignKey("show_entries.id", ondelete="CASCADE"),
        nullable=False,
    )
    place = Column(Integer, nullable=False)
    payout_cents = Column(Integer, nullable=False, server_default="0")
    aggregate_value = Column(Numeric(12, 3), nullable=False)
    tiebreaker_notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("side_pot_id", "show_entry_id"),
        CheckConstraint("place > 0", name="ck_side_pot_payouts_place_positive"),
        CheckConstraint(
            "payout_cents >= 0",
            name="ck_side_pot_payouts_payout_nonneg",
        ),
    )

    side_pot = relationship("SidePot", back_populates="payouts")
    show_entry = relationship("ShowEntry", back_populates="side_pot_payouts")
