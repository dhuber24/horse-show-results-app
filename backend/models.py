import uuid
from datetime import date, datetime
from sqlalchemy import (
    Column, Text, Date, Time, Boolean, Integer, LargeBinary, ForeignKey,
    ForeignKeyConstraint, Table, TIMESTAMP, UniqueConstraint, CheckConstraint,
    Index, Numeric, func, event, text
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID, JSONB
from sqlalchemy.orm import relationship
from database import Base


def _split_person_name(value: str | None) -> tuple[str, str]:
    name = (value or "").strip()
    if not name:
        return "", ""
    first, _, rest = name.partition(" ")
    return first.strip(), rest.strip()


def _compose_person_name(first_name: str | None, last_name: str | None) -> str:
    return " ".join(part for part in ((first_name or "").strip(), (last_name or "").strip()) if part)


horse_breeds = Table(
    "horse_breeds",
    Base.metadata,
    Column("horse_id", UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), primary_key=True),
    Column("breed_id", UUID(as_uuid=True), ForeignKey("breeds.id", ondelete="CASCADE"), primary_key=True),
)

judge_associations = Table(
    "judge_associations",
    Base.metadata,
    Column("judge_id", UUID(as_uuid=True), ForeignKey("judges.id", ondelete="CASCADE"), primary_key=True),
    Column("association_id", UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), primary_key=True),
)


class Association(Base):
    """A sanctioning/registry body a horse or person can be affiliated with.

    Distinct from `ShowType`, which is show *configuration* ("what kind of show
    is this?"). An association is a property of the horse or person ("this horse
    is registered with AQHA", "this rider is an NSBA member"). The same body can
    legitimately appear in both concepts — an AQHA show and an AQHA registration
    are different facts.

    `association_type` splits the registry two ways:
      - 'breed' — breed registries (AQHA, APHA, ApHC, FQHR)
      - 'club'  — club/sanctioning bodies (NSBA, WSCA)

    There is deliberately no row for OPEN: "Open" is the absence of a breed
    association, not a body anyone holds a membership with.
    """
    __tablename__ = "associations"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    code = Column(Text, nullable=False, unique=True)
    name = Column(Text, nullable=False)
    association_type = Column(
        Text,
        CheckConstraint("association_type IN ('breed', 'club')"),
        nullable=False,
    )
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class ShowType(Base):
    """Show configuration: what kind of show is being put on, which drives
    eligibility and the standard class catalogs. Breed-based types plus OPEN.
    Club bodies are NOT show types — an NSBA-sanctioned open show is an OPEN
    show carrying NSBA club sanctioning (see `ShowSanctioning`)."""
    __tablename__ = "show_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(Text, nullable=False, unique=True)
    name = Column(Text, nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    shows = relationship("Show", back_populates="show_type")


class ShowCategory(Base):
    """What kind of show this is, and the judge panel it permits.

    APHA SC-100 and SC-105 name four: Single-Judge, Two-Judge, Paint-O-Rama and
    Zone Show. Keyed on `show_types` the way `JudgingSystem` is -- which
    categories exist is the breed body's taxonomy, and `show_type_id` NULL is a
    generic row offered whatever the show type.

    `judge_limit_basis` is the column that keeps the findings honest. SC-100.A
    and SC-105.C.1 limit judges "in the arena at any given time", which is
    concurrency; the app records assignments and knows nothing about who is in
    the arena when, so for those the judge count is a hint that the category may
    be wrong rather than a rule check. SC-105.D.2 and SC-105.E.2 bound the total,
    and that the app can check outright.
    """
    __tablename__ = "show_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(
        UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=True
    )
    code = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    min_judges = Column(Integer, nullable=True)
    max_judges = Column(Integer, nullable=True)
    judge_limit_basis = Column(Text, nullable=False)
    min_days = Column(Integer, nullable=True)
    rule_reference = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show_type = relationship("ShowType", lazy="selectin")


class Venue(Base):
    __tablename__ = "venues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    address = Column(Text)
    city = Column(Text)
    state = Column(Text)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
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
    # The day entries close (migration 123). Records only: it does not gate
    # self-registration and it does not fire the `post_entry` fee. APHA SC-090.C
    # measures the approval-application deadline against this or the show's first
    # day, whichever comes first, and without it the app could only count from the
    # later of the two -- which is the optimistic direction on a deadline.
    entry_deadline = Column(Date, nullable=True)
    # What kind of show this is and the judge panel it allows (migration 124).
    # NULL means the show has not said, which is how every show predating the
    # migration reads -- and which APHA's application asks for.
    show_category_id = Column(UUID(as_uuid=True), ForeignKey("show_categories.id"), nullable=True)
    # A clinic run alongside the show. One boolean because it changes a check:
    # SC-105.C.3 exempts a two-judge show offered with a clinic from the SC-095
    # minimum class requirements.
    offers_clinic = Column(Boolean, nullable=False, server_default="false")
    status = Column(Text, nullable=False, default="DRAFT")
    apha_show_number = Column(Text, nullable=True)
    # APHA zone 1-14 (migration 119). NULL means not stated. Zones 12, 13 and 14
    # change class procedure for equitation and horsemanship — worked
    # individually from the gate, no rail work — and lower the Green class point
    # threshold to 10. Nothing derives it from the venue's state: a zone the app
    # guessed at would be wrong at exactly the shows that sit near a border.
    apha_zone = Column(Integer, nullable=True)
    aqha_show_number = Column(Text, nullable=True)
    aqha_approval_status = Column(Text, nullable=False, default="NOT_SUBMITTED")
    aqha_approval_submitted_at = Column(Date, nullable=True)
    aqha_approval_notes = Column(Text, nullable=True)
    office_charge_cents = Column(Integer, nullable=False, server_default="0")
    office_charge_basis = Column(Text, nullable=False, server_default="per_back_number")
    shavings_ban_outside = Column(Boolean, nullable=False, server_default="false")
    # Which show bill `/shows/{id}/showbill` renders (migration 127): the one the
    # app generates from this show's own classes, judges and fees, or a file the
    # show uploaded. Only ever 'uploaded' while a SHOWBILL row exists in
    # `show_documents` -- the pair is enforced in the router, because a CHECK
    # cannot see another table, and deleting the document resets this column in
    # the same transaction. A button pointing at a file nobody uploaded is the
    # one failure this column could introduce.
    showbill_source = Column(Text, nullable=False, server_default="generated")
    # Which health papers this show requires (migration 097). Coggins is
    # universal; a CVI follows from crossing a state line and vaccinations from
    # the venue, so those two are off unless the show says otherwise. The
    # *_valid_days windows are counted from the document's issue_date and only
    # apply when the document carries no expiry of its own.
    requires_coggins = Column(Boolean, nullable=False, server_default="true")
    requires_health_certificate = Column(Boolean, nullable=False, server_default="false")
    health_certificate_valid_days = Column(Integer, nullable=False, server_default="30")
    requires_vaccination = Column(Boolean, nullable=False, server_default="false")
    vaccination_valid_days = Column(Integer, nullable=False, server_default="365")
    vaccination_notes = Column(Text, nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    venue_rel = relationship("Venue", back_populates="shows")
    show_type = relationship("ShowType", back_populates="shows")
    # `lazy="selectin"` for the reason `Class.sanctioning` is: the show payload is
    # built by hand for every row of the show list, so an unloaded relationship
    # here is either N+1 lazy IO or a MissingGreenlet inside an async request.
    show_category = relationship("ShowCategory", lazy="selectin")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    affiliations = relationship("ShowAffiliation", back_populates="show", cascade="all, delete", lazy="selectin")
    rings = relationship("Ring", back_populates="show", cascade="all, delete")
    disciplines = relationship("Discipline", back_populates="show", cascade="all, delete")
    divisions = relationship("Division", back_populates="show", cascade="all, delete")
    classes = relationship("Class", back_populates="show", cascade="all, delete")
    show_secretaries = relationship("ShowSecretary", back_populates="show", cascade="all, delete")
    show_scribes = relationship("ShowScribe", back_populates="show", cascade="all, delete")
    show_gate_stewards = relationship("ShowGateSteward", back_populates="show", cascade="all, delete")
    show_managers = relationship("ShowManager", back_populates="show", cascade="all, delete")
    show_entries = relationship("ShowEntry", back_populates="show", cascade="all, delete")
    side_pots = relationship("SidePot", back_populates="show", cascade="all, delete")
    futurities = relationship("Futurity", back_populates="show", cascade="all, delete")
    fees = relationship("ShowFee", back_populates="show", cascade="all, delete", order_by="ShowFee.sort_order")
    judges = relationship("ShowJudge", back_populates="show", cascade="all, delete", order_by="ShowJudge.sort_order")
    sanctioning = relationship("ShowSanctioning", back_populates="show", cascade="all, delete", lazy="selectin")
    waivers = relationship(
        "ShowWaiver", back_populates="show", cascade="all, delete", order_by="ShowWaiver.sort_order"
    )


class ShowAffiliation(Base):
    """Secondary affiliations offered in some classes of a show."""
    __tablename__ = "show_affiliations"

    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), primary_key=True)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), primary_key=True)

    show = relationship("Show", back_populates="affiliations")
    show_type = relationship("ShowType", lazy="selectin")


class ShowDocument(Base):
    """A file the show uploaded about itself -- today, its own show bill.

    Shaped after `horse_documents` and `trainer_documents`: bytes in the row,
    MIME sniffed from the magic bytes rather than trusted from the client, and
    the uploader recorded.

    **There is deliberately no relationship from `Show` to here.** `_serialize`
    builds the show payload by hand for every row of the show list, so a
    `lazy="selectin"` relationship would pull a multi-megabyte BYTEA column into
    memory for every show on the browse screen, and a lazy one would be
    MissingGreenlet inside an async request. Readers that only need the metadata
    select the columns they want by name; the download endpoint is the one place
    that asks for `file_data`.
    """

    __tablename__ = "show_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    document_type = Column(
        Text,
        CheckConstraint("document_type IN ('SHOWBILL')"),
        nullable=False,
    )
    original_filename = Column(Text, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    mime_type = Column(Text, nullable=False)
    file_size = Column(Integer, nullable=False)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("show_id", "document_type", name="show_documents_show_type_uniq"),
    )


class Ring(Base):
    __tablename__ = "rings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=True)

    show = relationship("Show", back_populates="rings")
    classes = relationship("Class", back_populates="ring")


discipline_divisions = Table(
    "discipline_divisions",
    Base.metadata,
    Column("discipline_id", UUID(as_uuid=True),
           ForeignKey("disciplines.id", ondelete="CASCADE"), primary_key=True),
    Column("division_id", UUID(as_uuid=True),
           ForeignKey("divisions.id", ondelete="CASCADE"), primary_key=True),
    Column("sort_order", Integer, nullable=True),
)


class Discipline(Base):
    """Per-show riding style (Western Pleasure, Hunter Under Saddle, Trail, ...).
    Formerly known as Division before migration 074."""
    __tablename__ = "disciplines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=True)
    default_score_type = Column(Text, nullable=False, server_default="placement")

    show = relationship("Show", back_populates="disciplines")
    classes = relationship("Class", back_populates="discipline")
    divisions = relationship(
        "Division",
        secondary=discipline_divisions,
        back_populates="disciplines",
        order_by="Division.sort_order",
    )


class Division(Base):
    """Per-show age/skill bracket (Youth 14-18, Novice Amateur, Walk-Trot, ...),
    scoped to one or more Disciplines via discipline_divisions. Formerly known
    as Section before migration 074."""
    __tablename__ = "divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("show_id", "name", name="uq_divisions_show_name"),)

    show = relationship("Show", back_populates="divisions")
    classes = relationship("Class", back_populates="division")
    disciplines = relationship(
        "Discipline",
        secondary=discipline_divisions,
        back_populates="divisions",
        order_by="Discipline.sort_order",
    )


class StandardRing(Base):
    __tablename__ = "standard_rings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)


standard_discipline_divisions = Table(
    "standard_discipline_divisions",
    Base.metadata,
    Column("standard_discipline_id", UUID(as_uuid=True),
           ForeignKey("standard_disciplines.id", ondelete="CASCADE"), primary_key=True),
    Column("standard_division_id", UUID(as_uuid=True),
           ForeignKey("standard_divisions.id", ondelete="CASCADE"), primary_key=True),
    Column("sort_order", Integer, nullable=True),
)


class StandardDiscipline(Base):
    """Curated discipline lookup used by setup pickers. Formerly StandardDivision
    before migration 074."""
    __tablename__ = "standard_disciplines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=True)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    default_score_type = Column(Text, nullable=False, server_default="placement")

    divisions = relationship(
        "StandardDivision",
        secondary=standard_discipline_divisions,
        back_populates="disciplines",
    )


class StandardDivision(Base):
    """Curated age/skill bracket lookup used by setup pickers. Formerly
    StandardSection before migration 074."""
    __tablename__ = "standard_divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=True)
    name = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint(
            "show_type_id",
            "name",
            name="uq_standard_divisions_type_name",
            postgresql_nulls_not_distinct=True,
        ),
    )

    disciplines = relationship(
        "StandardDiscipline",
        secondary=standard_discipline_divisions,
        back_populates="divisions",
    )


class StandardClass(Base):
    """Canonical per-show-type class catalog used by the Setup matrix picker.

    Each row pairs a class to a (standard_division, standard_section) cell in
    the standard library matrix. Picking a class in the UI creates the
    per-show division/section/membership/class rows in one apply call.
    """
    __tablename__ = "standard_classes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    standard_discipline_id = Column(UUID(as_uuid=True), nullable=False)
    standard_division_id = Column(UUID(as_uuid=True), nullable=False)
    class_code = Column(Text, nullable=True)
    class_name = Column(Text, nullable=False)
    default_score_type = Column(Text, nullable=False, server_default="placement")
    default_entry_fee_cents = Column(Integer, nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")
    source_year = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        ForeignKeyConstraint(
            ["standard_discipline_id", "standard_division_id"],
            ["standard_discipline_divisions.standard_discipline_id",
             "standard_discipline_divisions.standard_division_id"],
            name="fk_standard_classes_discipline_division_pair",
            onupdate="CASCADE",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "show_type_id", "class_code",
            name="uq_standard_classes_type_code",
            postgresql_nulls_not_distinct=True,
        ),
    )


class Class(Base):
    __tablename__ = "classes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    ring_id = Column(UUID(as_uuid=True), ForeignKey("rings.id"), nullable=True)
    discipline_id = Column(UUID(as_uuid=True), ForeignKey("disciplines.id"), nullable=False)
    division_id = Column(UUID(as_uuid=True), ForeignKey("divisions.id", ondelete="RESTRICT"), nullable=False)
    class_number = Column(Text, nullable=False)
    class_name = Column(Text, nullable=False)
    class_date = Column(Date, nullable=False)
    status = Column(Text, nullable=False, default="OPEN")
    score_type = Column(Text, nullable=False, server_default="placement")
    entry_fee_cents = Column(Integer, nullable=False, server_default="0")
    # Entered by placing, not by signing up (migration 129). A Grand & Reserve
    # Champion halter class calls back the first and second from each qualifying
    # class, so there is nothing to enter at registration time. Seeded from the
    # class name by `rules.disciplines.entered_by_qualification` when the class
    # is created and owned by whoever edits the class thereafter -- the same
    # derive-then-store shape as `score_type`. Exhibitor self-registration
    # refuses these; the desk still enters them, because the office knows who
    # was called back and the app does not.
    entered_by_qualification = Column(Boolean, nullable=False, server_default="false")
    gate_status = Column(Text, nullable=False, server_default="pending")
    # NULL = results are a staff-only draft; timestamp = posted to the public
    # /live and /results screens. See migration 094.
    results_published_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # When the judge posted this class's pattern, and which pattern it was
    # (migration 120). Every pattern class in the rule book requires it at least
    # an hour before the class. The pattern *itself* is posted physically at the
    # show and is deliberately not stored — a second copy here could disagree
    # with the board exhibitors actually walked, and somebody would ride this one.
    pattern_posted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    pattern_notes = Column(Text, nullable=True)
    # Which card shape this class is judged on (migration 122). NULL means the
    # scribe types a total, which is how every class worked before this and how
    # a rail class still works.
    judging_system_id = Column(
        UUID(as_uuid=True), ForeignKey("judging_systems.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="classes")
    ring = relationship("Ring", back_populates="classes")
    discipline = relationship("Discipline", back_populates="classes")
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
    # `lazy="selectin"` for the same reason `associations` is: this is read on
    # every path that prices a class — the bill, the registration quote, the
    # public schedule — and an unloaded relationship in an async request is a
    # MissingGreenlet 500 rather than a wrong number. Loading it with the class
    # costs one extra SELECT and removes the eager-load footgun from every
    # caller.
    sanctioning = relationship(
        "ClassSanctioning",
        back_populates="class_",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["discipline_id", "division_id"],
            ["discipline_divisions.discipline_id", "discipline_divisions.division_id"],
            name="fk_classes_discipline_division_pair",
            onupdate="CASCADE",
            ondelete="CASCADE",
        ),
    )
    side_pot_classes = relationship(
        "SidePotClass", back_populates="class_", cascade="all, delete-orphan"
    )
    futurity_classes = relationship(
        "FuturityClass", back_populates="class_", cascade="all, delete-orphan"
    )
    futurity_division_classes = relationship(
        "FuturityDivisionClass", back_populates="class_", cascade="all, delete-orphan"
    )


class ClassSanctioning(Base):
    """Which clubs sanction this class.

    A club approves a list of classes, not a whole show: an NSBA-sanctioned
    show runs plenty of classes NSBA has nothing to do with, and an exhibitor
    entering one of those owes no sanction fee on it. A row here means the class
    carries that club's `show_sanctioning.per_class_fee_cents`.

    Points at `associations` and not `show_types` — clubs are deliberately not
    show types (migration 080), and `ClassAssociation` above answers a different
    question (the breed association's *class code*, for catalog imports).
    """

    __tablename__ = "class_sanctioning"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False
    )
    association_id = Column(
        UUID(as_uuid=True),
        ForeignKey("associations.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("class_id", "association_id", name="class_sanctioning_uniq"),
    )

    class_ = relationship("Class", back_populates="sanctioning")
    association = relationship("Association", lazy="selectin")


class ClassAssociation(Base):
    __tablename__ = "class_associations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    association_class_code = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("class_id", "show_type_id"),)

    class_ = relationship("Class", back_populates="associations")
    show_type = relationship("ShowType", lazy="selectin")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role = Column(Text, nullable=False)
    full_name = Column(Text, nullable=False)
    first_name = Column(Text, nullable=False)
    last_name = Column(Text, nullable=False)
    email = Column(Text, unique=True, nullable=False)
    hashed_password = Column(Text, nullable=True)
    last_login_at = Column(TIMESTAMP(timezone=True), nullable=True)
    is_approved = Column(Boolean, nullable=False, default=True)
    aqha_management_workshop_completed_at = Column(Date, nullable=True)
    # Self-serve password reset. question/hash are a pair (DB CHECK); the two
    # throttle columns gate the reset route only, never the password login.
    security_question = Column(Text, nullable=True)
    security_answer_hash = Column(Text, nullable=True)
    security_answer_set_at = Column(TIMESTAMP(timezone=True), nullable=True)
    security_answer_failed_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    security_answer_locked_until = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    audits = relationship("ResultAudit", back_populates="changed_by_user")
    exhibitor = relationship("Exhibitor", back_populates="user", uselist=False)
    secretary_shows = relationship("ShowSecretary", back_populates="user", cascade="all, delete")
    scribe_shows = relationship("ShowScribe", back_populates="user", cascade="all, delete")
    gate_steward_shows = relationship("ShowGateSteward", back_populates="user", cascade="all, delete")
    manager_shows = relationship("ShowManager", back_populates="user", cascade="all, delete")
    admin_venues = relationship("VenueAdmin", back_populates="user", cascade="all, delete")
    secretary_certifications = relationship("ShowSecretaryCertification", back_populates="user", cascade="all, delete")
    trainer_profile = relationship("Trainer", back_populates="user", uselist=False, passive_deletes=True)


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


class ShowScribe(Base):
    __tablename__ = "show_scribes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "user_id"),)

    show = relationship("Show", back_populates="show_scribes")
    user = relationship("User", back_populates="scribe_shows")


class ShowGateSteward(Base):
    __tablename__ = "show_gate_stewards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "user_id"),)

    show = relationship("Show", back_populates="show_gate_stewards")
    user = relationship("User", back_populates="gate_steward_shows")


class Breed(Base):
    __tablename__ = "breeds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horses = relationship("Horse", back_populates="breed")
    registered_horses = relationship("Horse", secondary=horse_breeds, back_populates="breeds")


class HorseColor(Base):
    __tablename__ = "horse_colors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horses = relationship("Horse", back_populates="color")


class HorsePattern(Base):
    """Spotting patterns — the second axis of a coat, independent of its color.

    Migration 116. Tobiano, Overo, Tovero, Sabino and the six Appaloosa patterns
    all sat in `horse_colors` beside Bay and Buckskin, so recording that a horse
    is a Bay Tobiano meant choosing which half to lose. APHA describes the two as
    separate things and a registration certificate states both.
    """
    __tablename__ = "horse_patterns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    horses = relationship("Horse", back_populates="pattern")


class Trainer(Base):
    __tablename__ = "trainers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    name = Column(Text, nullable=False)
    first_name = Column(Text, nullable=False)
    last_name = Column(Text, nullable=False)
    private_phone = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    email = Column(Text, nullable=True)

    business_name = Column(Text, nullable=True)
    city = Column(Text, nullable=True)
    state = Column(Text, nullable=True)
    country = Column(Text, nullable=False, server_default="US")
    website = Column(Text, nullable=True)
    bio = Column(Text, nullable=True)
    social_facebook = Column(Text, nullable=True)
    social_instagram = Column(Text, nullable=True)
    social_tiktok = Column(Text, nullable=True)
    is_public = Column(Boolean, nullable=False, server_default="false")

    safesport_completed_at = Column(Date, nullable=True)
    background_check_expires_at = Column(Date, nullable=True)
    has_liability_insurance = Column(Boolean, nullable=False, server_default="false")

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="trainer_profile")
    horses = relationship("Horse", back_populates="trainer", passive_deletes=True)
    registrations = relationship(
        "TrainerRegistration", back_populates="trainer", cascade="all, delete-orphan"
    )
    documents = relationship(
        "TrainerDocument", back_populates="trainer", cascade="all, delete-orphan"
    )


@event.listens_for(User, "before_insert")
@event.listens_for(User, "before_update")
def _sync_user_name_parts(mapper, connection, target: User) -> None:
    if not (target.first_name or "").strip() and not (target.last_name or "").strip():
        target.first_name, target.last_name = _split_person_name(target.full_name)
    target.full_name = _compose_person_name(target.first_name, target.last_name)


@event.listens_for(Trainer, "before_insert")
@event.listens_for(Trainer, "before_update")
def _sync_trainer_name_parts(mapper, connection, target: Trainer) -> None:
    if not (target.first_name or "").strip() and not (target.last_name or "").strip():
        target.first_name, target.last_name = _split_person_name(target.name)
    target.name = _compose_person_name(target.first_name, target.last_name)


class TrainerRegistration(Base):
    __tablename__ = "trainer_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trainer_id = Column(UUID(as_uuid=True), ForeignKey("trainers.id", ondelete="CASCADE"), nullable=False)
    association_id = Column(UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), nullable=False)
    member_number = Column(Text, nullable=False)
    status = Column(
        Text,
        CheckConstraint("status IN ('professional', 'non_pro', 'general')"),
        nullable=False,
        server_default="general",
    )
    expires_at = Column(Date, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("trainer_id", "association_id", name="uq_trainer_registrations_trainer_association"),
    )

    trainer = relationship("Trainer", back_populates="registrations")
    association = relationship("Association")


class TrainerDocument(Base):
    __tablename__ = "trainer_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trainer_id = Column(UUID(as_uuid=True), ForeignKey("trainers.id", ondelete="CASCADE"), nullable=False)
    document_type = Column(
        Text,
        CheckConstraint("document_type IN ('HEADSHOT')"),
        nullable=False,
    )
    original_filename = Column(Text, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    mime_type = Column(Text, nullable=False)
    file_size = Column(Integer, nullable=False)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    trainer = relationship("Trainer", back_populates="documents")


class Horse(Base):
    __tablename__ = "horses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The registered (association) name — what the horse is entered and published
    # under. barn_name is the optional stable/call name (migration 081).
    name = Column(Text, nullable=False)
    barn_name = Column(Text, nullable=True)
    owner_exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=True)
    created_by_exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=True)
    # Who actually pressed create. Show staff creating a horse for an exhibitor
    # at the desk have no exhibitor record of their own, so created_by_exhibitor_id
    # cannot attribute them (migration 090).
    created_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    owner_name = Column(Text, nullable=True)
    trainer_id = Column(UUID(as_uuid=True), ForeignKey("trainers.id", ondelete="SET NULL"), nullable=True)
    trainer_name = Column(Text, nullable=True)
    sire_name = Column(Text, nullable=True)
    dam_name = Column(Text, nullable=True)
    foaling_date = Column(Date, nullable=True)
    sex = Column(Text, CheckConstraint("sex IN ('Mare', 'Gelding', 'Stallion')"), nullable=True)
    breed_id = Column(UUID(as_uuid=True), ForeignKey("breeds.id"), nullable=True)
    color_id = Column(UUID(as_uuid=True), ForeignKey("horse_colors.id"), nullable=True)
    # Coat pattern, independent of colour (migration 116). A Paint is a colour
    # AND a pattern — "Bay Tobiano" — and one column could only hold one of them.
    pattern_id = Column(UUID(as_uuid=True), ForeignKey("horse_patterns.id"), nullable=True)
    is_solid_paint_bred = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    entries = relationship("Entry", back_populates="horse", passive_deletes=True)
    exhibitor_horses = relationship("ExhibitorHorse", back_populates="horse", cascade="all, delete")
    breed = relationship("Breed", back_populates="horses")
    breeds = relationship("Breed", secondary=horse_breeds, back_populates="registered_horses")
    color = relationship("HorseColor", back_populates="horses")
    pattern = relationship("HorsePattern", back_populates="horses")
    trainer = relationship("Trainer", back_populates="horses")
    registrations = relationship("HorseRegistration", back_populates="horse", cascade="all, delete")
    documents = relationship("HorseDocument", back_populates="horse", cascade="all, delete")
    owner_exhibitor = relationship("Exhibitor", foreign_keys=[owner_exhibitor_id])
    created_by_exhibitor = relationship("Exhibitor", foreign_keys=[created_by_exhibitor_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])


class Exhibitor(Base):
    __tablename__ = "exhibitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    full_name = Column(Text, nullable=False)
    apha_member_number = Column(Text, nullable=True)
    apha_member_expiry = Column(Date, nullable=True)
    amateur_card_number = Column(Text, nullable=True)
    amateur_card_expiry = Column(Date, nullable=True)
    amateur_novice_codes = Column(Text, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    phone = Column(Text, nullable=True)
    address = Column(Text, nullable=True)
    city = Column(Text, nullable=True)
    state = Column(Text, nullable=True)
    zip = Column(Text, nullable=True)
    emergency_contact_name = Column(Text, nullable=True)
    emergency_contact_phone = Column(Text, nullable=True)
    parent_guardian_name = Column(Text, nullable=True)
    parent_guardian_phone = Column(Text, nullable=True)
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
    # How this exhibitor is entitled to show this horse -- APHA AM-300.E and
    # YP-015 (migration 128). A fact about the person and the horse, not about
    # the class, so it is answered once here and copied onto every entry rather
    # than picked from a list of twenty-five on each one.
    #
    # Here rather than on `horses` because two people may show the same horse
    # and their relationships to its owner are different answers.
    relationship_to_owner = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("exhibitor_id", "horse_id"),)

    exhibitor = relationship("Exhibitor", back_populates="exhibitor_horses")
    horse = relationship("Horse", back_populates="exhibitor_horses")


class HorseAccessRequest(Base):
    """Consent, pending, for a horse changing hands (migration 087).

    `kind='link'` is someone asking the owner to put their horse on that
    person's profile; `kind='transfer'` is the owner handing ownership over.
    Either way `approver_exhibitor_id` is whoever must press the button, so
    approve/decline is one code path rather than two.
    """
    __tablename__ = "horse_access_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    token = Column(Text, nullable=False, unique=True)
    kind = Column(Text, nullable=False)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=False)
    horse_name = Column(Text, nullable=False)
    requester_exhibitor_id = Column(
        UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="SET NULL"), nullable=True
    )
    requested_by_name = Column(Text, nullable=False)
    approver_exhibitor_id = Column(
        UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="SET NULL"), nullable=True
    )
    approver_name = Column(Text, nullable=False)
    approver_email = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="pending")
    message = Column(Text, nullable=True)
    email_sent = Column(Boolean, nullable=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    responded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Declared here as well as in the migration, and named to match it: startup
    # create_all races the migration runner, and a table it creates first makes
    # the migration's CREATE TABLE IF NOT EXISTS a no-op. Constraints that live
    # only in the SQL are silently lost on those databases (migration 089).
    __table_args__ = (
        CheckConstraint(
            "kind IN ('link', 'transfer')", name="ck_horse_access_requests_kind"
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'declined', 'cancelled', 'expired')",
            name="ck_horse_access_requests_status",
        ),
    )

    horse = relationship("Horse")
    requester = relationship("Exhibitor", foreign_keys=[requester_exhibitor_id])
    approver = relationship("Exhibitor", foreign_keys=[approver_exhibitor_id])


class ExhibitorRegistration(Base):
    __tablename__ = "exhibitor_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=False)
    association_id = Column(UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), nullable=False)
    member_number = Column(Text, nullable=False)
    # When the membership lapses (migration 117). NULL means unknown, not
    # current. Judged against the show's end date wherever it is read — never
    # against today, the same rule health paperwork follows.
    expires_at = Column(Date, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("exhibitor_id", "association_id", name="uq_exhibitor_registrations_exhibitor_association"),
    )

    exhibitor = relationship("Exhibitor", back_populates="registrations")
    association = relationship("Association")


class HorseRegistration(Base):
    __tablename__ = "horse_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=False)
    association_id = Column(UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), nullable=False)
    registration_number = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("horse_id", "association_id", name="uq_horse_registrations_horse_association"),
        UniqueConstraint("association_id", "registration_number", name="uq_horse_registrations_association_number"),
    )

    horse = relationship("Horse", back_populates="registrations")
    association = relationship("Association")


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


class DocumentExtraction(Base):
    """One AI read of an uploaded horse document, with what the human did next.

    Written when a document is analyzed — before it is saved — and linked to the
    resulting `HorseDocument` if the uploader goes on to save. The model only
    ever suggests; `overridden_fields` records where the person disagreed, which
    is what makes a stored `expiry_date` answerable later: typed, accepted, or
    corrected.
    """
    __tablename__ = "document_extractions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Null when the document was read before its horse existed — the add-a-horse
    # wizard stages documents in the browser and saves them only after creation.
    # Set when the queued document is finally saved.
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=True)
    # Null until save; null forever if the uploader abandons the upload.
    document_id = Column(UUID(as_uuid=True), ForeignKey("horse_documents.id", ondelete="CASCADE"), nullable=True)

    original_filename = Column(Text, nullable=False)
    mime_type = Column(Text, nullable=False)
    file_size = Column(Integer, nullable=False)

    status = Column(Text, nullable=False)
    error_message = Column(Text, nullable=True)

    extracted = Column(JSONB, nullable=True)
    accepted = Column(JSONB, nullable=True)
    overridden_fields = Column(ARRAY(Text), nullable=False, server_default="{}")

    model = Column(Text, nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)

    requested_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    linked_at = Column(TIMESTAMP(timezone=True), nullable=True)

    horse = relationship("Horse")
    document = relationship("HorseDocument")
    requested_by = relationship("User")


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
    association_id = Column(UUID(as_uuid=True), ForeignKey("associations.id", ondelete="SET NULL"), nullable=True)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    exhibitor = relationship("Exhibitor", back_populates="documents")
    association = relationship("Association")
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
    gate_order = Column(Integer, nullable=True)
    gate_checked_in = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        # Exhibitor-per-class is enforced in application code (entries router
        # + show registration router) because pattern classes allow multiples.
        Index(
            "entries_class_horse_uniq",
            "class_id",
            "horse_id",
            unique=True,
            postgresql_where=text("horse_id IS NOT NULL"),
        ),
        CheckConstraint(
            # The Walk-Trot divisions (AM-300, YP-109, YP-110) arrived in
            # migration 115. Youth Walk-Trot is split by age because APHA runs
            # 11-18 and 5-10 as separate divisions with separate class lists.
            "apha_division IN ('OPEN','SOLID_PAINT_BRED','AMATEUR','NOVICE_AMATEUR',"
            "'AMATEUR_WALK_TROT','YOUTH','NOVICE_YOUTH','YOUTH_WALK_TROT_11_18',"
            "'YOUTH_WALK_TROT_5_10')",
            name="ck_entries_apha_division",
        ),
    )

    class_ = relationship("Class", back_populates="entries")
    exhibitor = relationship("Exhibitor", back_populates="entries")
    horse = relationship("Horse", back_populates="entries")
    # `lazy="selectin"` for the same reason `Class.sanctioning` is: every path
    # that validates an entry reads this, and an unloaded relationship inside an
    # async request is a MissingGreenlet 500 rather than a missing declaration.
    # Assigning the list before flush is what lets the rules engine see an
    # attestation on an entry that has not been written yet.
    attestations = relationship(
        "EntryAttestation",
        back_populates="entry",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    # One row per judge who placed the class (migration 095), so this is a list.
    # It was uselist=False when a class could only hold one card; leaving it
    # scalar would raise as soon as a second judge handed one in.
    results = relationship("Result", back_populates="entry")


class Result(Base):
    __tablename__ = "results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    # Whose card this placing came off (migration 095). Points at the *assignment*
    # rather than the registry judge: "who placed this class" is a fact about this
    # show. NULL is unattributed — results entered before judges were assigned, and
    # pre-095 rows on a multi-judge show, which the read paths show as one column.
    judge_id = Column(UUID(as_uuid=True), ForeignKey("show_judges.id", ondelete="RESTRICT"), nullable=True)
    # Nullable since migration 121. A disqualified or no-scored entry has no
    # placing, and forcing one on it was the reason those states could not be
    # recorded at all.
    place = Column(Integer, nullable=True)
    raw_score = Column(Numeric(10, 3), nullable=True)
    is_tie = Column(Boolean, default=False)
    # What happened on this judge's card (migration 121). Per judge rather than
    # per entry because a card is what a judge hands in, and `place` — the thing
    # this qualifies — has always lived here. The coarser `Entry.is_disqualified`
    # stays: it takes an entry out of the class before anybody judges it.
    outcome = Column(Text, nullable=False, server_default="placed", default="placed")
    outcome_note = Column(Text, nullable=True)
    # How the judge broke a tie between equal scores, lowest first. Separate from
    # raw_score so recording the decision never edits the number the judge called.
    tiebreak_rank = Column(Integer, nullable=True)
    notes = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Uniqueness is (class, judge, entry) and lives in two partial indexes in
    # migration 095 — NULL judge_id needs its own, since NULLs are distinct in a
    # plain unique index. Not declared here: the old UniqueConstraint on
    # (class_id, place, entry_id) actively rejected two judges giving the same
    # horse the same place, so it must not come back via create_all.
    __table_args__ = (
        CheckConstraint("place > 0"),
        CheckConstraint(
            "outcome IN ('placed','disqualified','eliminated','zero_score','no_score')",
            name="ck_results_outcome",
        ),
        CheckConstraint(
            "outcome <> 'placed' OR place IS NOT NULL",
            name="ck_results_placed_has_place",
        ),
        CheckConstraint(
            "tiebreak_rank IS NULL OR tiebreak_rank > 0",
            name="ck_results_tiebreak_rank",
        ),
    )

    class_ = relationship("Class", back_populates="results")
    entry = relationship("Entry", back_populates="results")
    judge = relationship("ShowJudge", lazy="selectin")
    audits = relationship("ResultAudit", back_populates="result", cascade="all, delete")


class EntryAttestation(Base):
    """What the entrant declared about an entry, and when (migration 118).

    Recorded, never verified. APHA's Novice divisions are gated on points and
    prize money the app does not hold and never will, and the rule book puts the
    responsibility on the exhibitor (AM-205) with the burden of proof on whoever
    protests (YP-255.A.1). So the honest thing is to capture the declaration —
    who made it, when, and the exact words — rather than to pretend to check it.

    `statement` is a stored copy rather than a lookup for the same reason a
    signed waiver keeps its own text: the wording changes when APHA revises its
    limits, and a pointer would silently restate what somebody agreed to two
    seasons ago. It is written by the backend from `rules.apha`, never taken
    from the client.
    """
    __tablename__ = "entry_attestations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    kind = Column(Text, nullable=False)
    statement = Column(Text, nullable=False)
    attested_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Denormalized snapshot, like coggins_override_audit's, so the row stays
    # readable after the user record goes.
    attested_by_name = Column(Text, nullable=True)
    attested_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("kind IN ('novice_eligibility')", name="ck_entry_attestations_kind"),
        UniqueConstraint("entry_id", "kind", name="uq_entry_attestations_entry_kind"),
    )

    entry = relationship("Entry", back_populates="attestations")


class JudgingSystem(Base):
    """How a judge's card is marked (migration 122).

    There is no single card shape. Equitation on the flat scores maneuvers -3 to
    +3 in half points against fixed 3/5/10 penalty tiers; Equitation Over Fences
    (AM-111.F) scores each fence -1.5 to +1.5 on a 0-100 scale; cow work
    (SC-265.E) uses 1/3/5 penalties with letter codes. So the scale is declared
    here and the sheet is built from whichever applies.

    `show_type_id` NULL means generic — usable at any show. It points at
    `show_types` rather than `associations` for the same reason
    `association_standard_classes` does: how a class is scored is the breed
    body's catalog question, not a property of a horse or a person.
    """
    __tablename__ = "judging_systems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(
        UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=True
    )
    code = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    # NULL means the total is the sum of the maneuvers alone.
    base_score = Column(Numeric(10, 3), nullable=True)
    maneuver_min = Column(Numeric(10, 3), nullable=False)
    maneuver_max = Column(Numeric(10, 3), nullable=False)
    maneuver_step = Column(Numeric(10, 3), nullable=False)
    unit_label = Column(Text, nullable=False)
    # NULL means the class decides — a trail pattern has as many obstacles as
    # the judge built.
    unit_count = Column(Integer, nullable=True)
    score_max = Column(Numeric(10, 3), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    penalties = relationship(
        "JudgingPenalty",
        back_populates="system",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="JudgingPenalty.sort_order",
    )


class JudgingPenalty(Base):
    """One named penalty a system recognises.

    Either a fixed `value`, or a `min_value`/`max_value` range the judge chooses
    within — about a third of AM-111.F's table is the second kind. The catalog
    is a convenience rather than the vocabulary: `CardPenalty.label` is free text
    so a scribe can always record what the judge called.
    """
    __tablename__ = "judging_penalties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    system_id = Column(
        UUID(as_uuid=True), ForeignKey("judging_systems.id", ondelete="CASCADE"), nullable=False
    )
    code = Column(Text, nullable=True)
    label = Column(Text, nullable=False)
    value = Column(Numeric(10, 3), nullable=True)
    min_value = Column(Numeric(10, 3), nullable=True)
    max_value = Column(Numeric(10, 3), nullable=True)
    applies_to = Column(Text, nullable=False, server_default="run", default="run")
    sort_order = Column(Integer, nullable=False, server_default="0", default=0)
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)

    __table_args__ = (
        CheckConstraint(
            "(value IS NOT NULL AND min_value IS NULL AND max_value IS NULL)"
            " OR (value IS NULL AND min_value IS NOT NULL AND max_value IS NOT NULL)",
            name="ck_judging_penalties_shape",
        ),
        CheckConstraint(
            "applies_to IN ('run','maneuver')", name="ck_judging_penalties_applies_to"
        ),
    )

    system = relationship("JudgingSystem", back_populates="penalties")


class JudgeCard(Base):
    """One worksheet: this entry, this class, this judge (migration 122).

    **Keyed on (class, entry, judge) rather than on a `results` row.**
    `bulk_save_results` is a delete-all-then-insert-all within one judge's card
    and the scribe screens autosave on a settle, so anything hanging off
    `results.id` by foreign key would be destroyed every time somebody typed.

    The card computes and the result records: `computed_score` comes from
    `backend/judging.py`, `override_score` is a human disagreeing with the
    arithmetic, and the effective figure reaches `results.raw_score` through the
    ordinary save path so `results` keeps exactly one writer.
    """
    __tablename__ = "judge_cards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    judge_id = Column(
        UUID(as_uuid=True), ForeignKey("show_judges.id", ondelete="CASCADE"), nullable=True
    )
    system_id = Column(
        UUID(as_uuid=True), ForeignKey("judging_systems.id", ondelete="SET NULL"), nullable=True
    )
    computed_score = Column(Numeric(10, 3), nullable=True)
    override_score = Column(Numeric(10, 3), nullable=True)
    override_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Uniqueness is (class, entry, judge) and lives in two partial indexes in
    # migration 122 — NULLs are distinct in a plain unique index, so the
    # unattributed card would accept duplicates. Same shape as migration 095.
    system = relationship("JudgingSystem", lazy="selectin")
    maneuvers = relationship(
        "CardManeuver",
        back_populates="card",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="CardManeuver.sequence",
    )
    penalties = relationship(
        "CardPenalty",
        back_populates="card",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CardManeuver(Base):
    __tablename__ = "card_maneuvers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_id = Column(UUID(as_uuid=True), ForeignKey("judge_cards.id", ondelete="CASCADE"), nullable=False)
    sequence = Column(Integer, nullable=False)
    # NULL is a maneuver the judge has not marked yet, which is not a zero.
    score = Column(Numeric(10, 3), nullable=True)
    label = Column(Text, nullable=True)

    __table_args__ = (CheckConstraint("sequence > 0", name="ck_card_maneuvers_sequence"),)

    card = relationship("JudgeCard", back_populates="maneuvers")


class CardPenalty(Base):
    __tablename__ = "card_penalties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_id = Column(UUID(as_uuid=True), ForeignKey("judge_cards.id", ondelete="CASCADE"), nullable=False)
    # Optional on purpose — a penalty the judge called that nobody has loaded is
    # still a penalty, and refusing it would send the scribe looking for the
    # nearest wrong answer.
    penalty_id = Column(
        UUID(as_uuid=True), ForeignKey("judging_penalties.id", ondelete="SET NULL"), nullable=True
    )
    label = Column(Text, nullable=False)
    value = Column(Numeric(10, 3), nullable=False)
    # Which maneuver or fence it happened on. NULL means the run as a whole.
    sequence = Column(Integer, nullable=True)

    card = relationship("JudgeCard", back_populates="penalties")


class ResultAudit(Base):
    __tablename__ = "result_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    result_id = Column(UUID(as_uuid=True), ForeignKey("results.id", ondelete="CASCADE"), nullable=True)
    changed_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    old_place = Column(Integer)
    new_place = Column(Integer)
    # Score corrections alongside the placing corrections (migration 122). An
    # override of the card's arithmetic is exactly the kind of editorial
    # decision this table exists for.
    old_score = Column(Numeric(10, 3), nullable=True)
    new_score = Column(Numeric(10, 3), nullable=True)
    changed_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    result = relationship("Result", back_populates="audits")
    changed_by_user = relationship("User", back_populates="audits")


class CogginsOverrideAudit(Base):
    """One row per effective show-staff bypass of the old Coggins entry gate.

    **Historical.** Nothing writes this any more: an override only means
    something while there is a block to override, and health paperwork no longer
    gates entry — a horse with a missing, undated, or lapsed Coggins is entered
    and turns up on the show's health flags instead (`routers/show_office.py`).
    The rows already here describe real bypasses of the rule as it stood, so
    they are kept and stay readable; an audit trail that vanishes when the rule
    changes was never an audit trail.

    Rows were written only when the override actually mattered — passing the
    flag for a horse that already held a valid Coggins recorded nothing.
    `horse_name` and `overridden_by_name` are denormalized snapshots so a row
    stays readable after the horse or the staff account is deleted
    (migration 082).
    """

    __tablename__ = "coggins_override_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="SET NULL"), nullable=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="SET NULL"), nullable=True)
    horse_name = Column(Text, nullable=False)
    # The status that was bypassed: 'missing', 'undated', or 'expired'.
    coggins_status = Column(Text, nullable=False)
    overridden_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    overridden_by_name = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class ShowVerification(Base):
    """One document a show's office physically inspected (migrations 090, 098).

    Four kinds, one table, because the actor, the question, and the staleness
    rule are identical for all of them: `horse_age` (foaling date on the
    registration papers), `horse_registration` (one association's registration
    number), `exhibitor_membership` (one association's membership number),
    `horse_health_document` (a Coggins, CVI, or vaccination record seen at the
    counter). `kind` fixes which subject columns are populated.

    A `trainer_membership` kind existed briefly (migration 098, reversed by
    100). The trainer is not at the counter, has no entry and no back number,
    and their card is the association's business rather than this show's — the
    check was permanently unverified and inflated every outstanding count.

    `horse_health_document` is keyed on `(horse_id, document_type)` rather than
    on a `horse_documents` row, because the paper is often not in the app at
    all — an exhibitor hands over a physical Coggins and there is nothing to
    point at. Requiring an upload would break the sign-off in the exact case it
    exists for. What the derivation makes of the file is a separate question,
    answered by the health flags.

    Scoped to a show on purpose — this is a show attesting that its own office
    saw the paper, not a permanent property of the horse or the person, so a
    single bad sign-off cannot propagate to every future show.

    `verified_value` is the snapshot of what was on file at sign-off, derived
    server-side and never accepted from the client. It is what lets a check go
    stale: edit the number afterwards and the stored value no longer matches.
    """

    __tablename__ = "show_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    kind = Column(Text, nullable=False)
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="CASCADE"), nullable=True)
    exhibitor_id = Column(
        UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=True
    )
    association_id = Column(
        UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), nullable=True
    )
    # COGGINS | VACCINATION | HEALTH_CERTIFICATE, for horse_health_document only.
    document_type = Column(Text, nullable=True)
    # The expiry printed on the paper the office was handed (migration 101).
    # Staff-entered, because the app cannot derive a date off a document it has
    # never been shown — and an office blind to paper is an office that keeps
    # chasing paperwork it already has. Optional: an illegible or genuinely
    # lapsed document is still worth recording as inspected, and the horse stays
    # flagged. Never an input to the derived standing, only an overlay on it.
    attested_expiry = Column(Date, nullable=True)
    verified_value = Column(Text, nullable=False)
    note = Column(Text, nullable=True)
    verified_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_by_name = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Declared here as well as in the migration, and named to match it: startup
    # create_all races the migration runner, and a table it creates first makes
    # the migration's CREATE TABLE IF NOT EXISTS a no-op (see migration 089).
    # The unique indexes are partial because the subject columns are nullable per
    # kind and Postgres treats NULLs as distinct — a plain UniqueConstraint would
    # not stop the same horse's age being signed off twice.
    __table_args__ = (
        CheckConstraint(
            "kind IN ('horse_age', 'horse_registration', 'exhibitor_membership')",
            name="ck_show_verifications_kind",
        ),
        CheckConstraint(
            "(kind = 'horse_age'"
            " AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL)"
            " OR (kind = 'horse_registration'"
            " AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NOT NULL)"
            " OR (kind = 'exhibitor_membership'"
            " AND exhibitor_id IS NOT NULL AND horse_id IS NULL AND association_id IS NOT NULL)",
            name="ck_show_verifications_subject",
        ),
        Index(
            "uq_show_verifications_horse_age",
            "show_id", "horse_id",
            unique=True,
            postgresql_where=text("kind = 'horse_age'"),
        ),
        Index(
            "uq_show_verifications_horse_registration",
            "show_id", "horse_id", "association_id",
            unique=True,
            postgresql_where=text("kind = 'horse_registration'"),
        ),
        Index(
            "uq_show_verifications_exhibitor_membership",
            "show_id", "exhibitor_id", "association_id",
            unique=True,
            postgresql_where=text("kind = 'exhibitor_membership'"),
        ),
        Index("idx_show_verifications_show", "show_id"),
    )

    show = relationship("Show")
    horse = relationship("Horse")
    exhibitor = relationship("Exhibitor")
    association = relationship("Association")
    verified_by_user = relationship("User")


class ShowFee(Base):
    __tablename__ = "show_fees"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    code = Column(Text, nullable=False)
    label = Column(Text, nullable=False)
    amount_cents = Column(Integer, nullable=False, server_default="0")
    unit = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    # Early-bird rate (migration 092). A pair: both set = the discount is live,
    # either alone is an unfinished edit and is ignored. `amount_cents` remains
    # the standard rate. Read these through billing.fee_rate_cents, never
    # directly — see RESERVABLE_FEE_UNITS for what an early rate can apply to.
    early_amount_cents = Column(Integer, nullable=True)
    early_deadline = Column(Date, nullable=True)
    # The floor under a reservable line (migration 128). A show that bans
    # outside shavings is telling exhibitors to buy bedding here, and "buy some"
    # with no number is a stall bedded with two bags at a show that wanted four.
    # 0 -- the default, and every row before this -- means no floor. Only
    # meaningful on a reservable unit, the same rule that governs where an early
    # rate may be set, and enforced in the router for the same reason: the unit
    # families live in billing.py rather than in the schema.
    min_quantity = Column(Integer, nullable=False, server_default="0")
    # Whether an automatic charge counts only the breed association's own
    # classes (migration 130) -- a show's own invented per-horse or
    # per-judge-per-horse fee can carry this; per_judge_per_entry is always
    # scoped this way regardless of the column, because that unit is the
    # breed body's own assessment (SC-125.B) by definition. See
    # billing.charge_lines.
    breed_association_only = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="fees")


class Judge(Base):
    """A judge, as a person rather than as a line on one show.

    Show setup picks from this registry and reads the details off it; the
    details are not restated per show. `associations` is what the judge is
    carded with, and points at `Association` (the affiliation registry), not
    at `ShowType` (show configuration)."""
    __tablename__ = "judges"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    first_name = Column(Text, nullable=False)
    last_name = Column(Text, nullable=False)
    email = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    associations = relationship(
        "Association",
        secondary=judge_associations,
        lazy="selectin",
        order_by="Association.code",
    )


class ShowJudge(Base):
    """Assignment of a registry judge to a show. Carries no judge details of
    its own — those live on `Judge`."""
    __tablename__ = "show_judges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    judge_id = Column(UUID(as_uuid=True), ForeignKey("judges.id", ondelete="RESTRICT"), nullable=False)
    sort_order = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="judges")
    judge = relationship("Judge", lazy="selectin")


class ShowEntry(Base):
    __tablename__ = "show_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    exhibitor_id = Column(UUID(as_uuid=True), ForeignKey("exhibitors.id"), nullable=False)
    back_number = Column(Integer, nullable=True)
    # What the exhibitor asked for (migration 104), as against `back_number`,
    # which is what the show issued. Granted into `back_number` at the moment
    # of asking when nothing else at the show holds it; kept afterwards so the
    # desk can see "asked for 42, has 87" once the office renumbers.
    preferred_back_number = Column(Integer, nullable=True)
    # Set when the exhibitor completes show sign-up (migration 088). NULL means
    # this is a shell row a secretary created while adding an entry by hand —
    # the exhibitor has not signed up and cannot self-register for classes.
    registered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # The registration was called off (migration 126). Marked rather than
    # deleted because this row cascades to `show_payments`, and a cancellation
    # must not be able to erase money that moved. On the roster is
    # `registered_at IS NOT NULL AND cancelled_at IS NULL` -- read it through
    # `is_on_roster()` rather than spelling it out again.
    cancelled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cancelled_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancellation_reason = Column(Text, nullable=True)
    arrival_date = Column(Date, nullable=True)
    departure_date = Column(Date, nullable=True)
    registration_notes = Column(Text, nullable=True)
    # Stabling requests -- "put me next to the Smith barn" (migration 128).
    # Apart from `registration_notes` because the office reads the two at
    # different moments: every stall request at once, while the chart is being
    # drawn, against "arriving late Friday" at the gate.
    stall_request = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("show_id", "exhibitor_id"),
        UniqueConstraint("show_id", "back_number"),
    )

    show = relationship("Show", back_populates="show_entries")
    exhibitor = relationship("Exhibitor")
    reservations = relationship(
        "ShowEntryReservation", back_populates="show_entry", cascade="all, delete-orphan"
    )
    payments = relationship(
        "ShowPayment", back_populates="show_entry", cascade="all, delete-orphan"
    )
    side_pot_entries = relationship(
        "SidePotEntry", back_populates="show_entry", cascade="all, delete-orphan"
    )
    side_pot_payouts = relationship(
        "SidePotPayout", back_populates="show_entry", cascade="all, delete-orphan"
    )
    futurity_entries = relationship(
        "FuturityEntry", back_populates="show_entry", cascade="all, delete-orphan"
    )


class ShowEntryReservation(Base):
    """How many of a given show fee this exhibitor reserved at sign-up.

    Points at `ShowFee` rather than restating stalls/shavings/camping as
    columns: the secretary already configures those with prices and units, and
    what an exhibitor may reserve is derived from the unit (see
    RESERVABLE_FEE_UNITS in `routers/show_registration.py`).
    """
    __tablename__ = "show_entry_reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_entry_id = Column(
        UUID(as_uuid=True), ForeignKey("show_entries.id", ondelete="CASCADE"), nullable=False
    )
    show_fee_id = Column(
        UUID(as_uuid=True), ForeignKey("show_fees.id", ondelete="CASCADE"), nullable=False
    )
    quantity = Column(Integer, nullable=False, server_default="0")
    # When this line was first booked (migration 092). Decides which of the
    # fee's two rates applies, and is deliberately preserved when the exhibitor
    # amends their sign-up — an exhibitor who reserved before the deadline
    # keeps the early rate they were quoted.
    reserved_at = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("show_entry_id", "show_fee_id"),
        # See HorseAccessRequest.__table_args__ for why this is declared here
        # and not only in the migration.
        CheckConstraint("quantity >= 0", name="ck_show_entry_reservations_quantity"),
    )

    show_entry = relationship("ShowEntry", back_populates="reservations")
    show_fee = relationship("ShowFee")


class ShowPayment(Base):
    """Money the office recorded collecting on an account (migration 096).

    Recording, not processing: no card is handled and no processor is called.
    The desk takes a check and writes down that it happened, which is what lets
    `billed − paid = balance` mean anything. Without this table an outstanding
    balance would read as the full bill for everyone, forever.

    Scoped to the exhibitor's account at one show rather than to an individual
    charge — the office takes one check for the whole bill, and per-line
    allocation would be an accounts-receivable ledger nobody at the desk keeps.

    `amount_cents` is signed. A refund is a negative row rather than an edit to
    the original payment, so the day's takings still reconcile against what
    actually moved.
    """
    __tablename__ = "show_payments"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_entry_id = Column(
        UUID(as_uuid=True), ForeignKey("show_entries.id", ondelete="CASCADE"), nullable=False
    )
    amount_cents = Column(Integer, nullable=False)
    method = Column(Text, nullable=False)
    reference = Column(Text, nullable=True)
    received_on = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    note = Column(Text, nullable=True)
    recorded_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Denormalized so the row stays readable after a seasonal staff account is
    # removed — the same reason ShowVerification keeps verified_by_name.
    recorded_by_name = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Declared here as well as in the migration, and named to match: startup
    # create_all races the migration runner, and constraints that live only in
    # the SQL are lost on databases where the app created the table first
    # (see migration 089).
    __table_args__ = (
        CheckConstraint(
            "method IN ('cash', 'check', 'card', 'transfer', 'other')",
            name="ck_show_payments_method",
        ),
        CheckConstraint("amount_cents <> 0", name="ck_show_payments_amount_nonzero"),
    )

    show_entry = relationship("ShowEntry", back_populates="payments")
    recorded_by_user = relationship("User")


class ShowContactMessage(Base):
    """A message sent to a show from its public page (migration 090).

    An inbox, not an email relay: `mailer.py` is best-effort and silently does
    nothing without SMTP, and a contact form that loses messages is worse than
    no contact form. Staff read these on the show's Messages screen.

    Everything about the sender is self-reported and unverified — the feature
    exists for visitors with no account, so none of it is joined to `users`.
    """
    __tablename__ = "show_contact_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    sender_name = Column(Text, nullable=False)
    sender_email = Column(Text, nullable=False)
    sender_phone = Column(Text, nullable=True)
    subject = Column(Text, nullable=True)
    message = Column(Text, nullable=False)
    status = Column(Text, nullable=False, server_default="new")
    # Who sent it, when the app knows (migration 103). NULL is the original
    # case and still the common one — a visitor with no account. Written from
    # the session on the server, never from the request body, so a sender
    # cannot claim to be an entrant they are not.
    sender_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_exhibitor_id = Column(
        UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="SET NULL"), nullable=True
    )
    handled_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    handled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Declared here as well as in the migration, and named to match: startup
    # create_all races the migration runner, and constraints that live only in
    # the SQL are lost on databases where the app created the table first
    # (see migration 089).
    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'read', 'archived')",
            name="ck_show_contact_messages_status",
        ),
    )

    show = relationship("Show")
    # foreign_keys is required, not decorative: since migration 103 this table
    # has two FKs to `users` — who sent it and who dealt with it — and without
    # it SQLAlchemy raises AmbiguousForeignKeysError at mapper configuration,
    # which takes the whole app down on its first ORM query rather than here.
    handled_by = relationship("User", foreign_keys=[handled_by_user_id])
    sender_user = relationship("User", foreign_keys=[sender_user_id])
    sender_exhibitor = relationship("Exhibitor", foreign_keys=[sender_exhibitor_id])


class ShowSecretaryCertification(Base):
    __tablename__ = "show_secretary_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    association_id = Column(UUID(as_uuid=True), ForeignKey("associations.id", ondelete="CASCADE"), nullable=False)
    secretary_id_number = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "association_id", name="uq_secretary_certifications_user_association"),
    )

    user = relationship("User", back_populates="secretary_certifications")
    association = relationship("Association")


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


class AssociationClassImport(Base):
    """One applied class-code upload, so a catalog row can name where it came from."""

    __tablename__ = "association_class_imports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    filename = Column(Text, nullable=False)
    source_year = Column(Integer, nullable=True)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    added_count = Column(Integer, nullable=False, server_default="0")
    changed_count = Column(Integer, nullable=False, server_default="0")
    retired_count = Column(Integer, nullable=False, server_default="0")
    unchanged_count = Column(Integer, nullable=False, server_default="0")

    show_type = relationship("ShowType", lazy="selectin")


class AssociationStandardClassVersion(Base):
    """Every version of every class code an association has published.

    Type 2: rows are never updated in place and never deleted. A changed name
    closes the open version (`inactive_date`) and opens a new one; a code
    dropped from the new file just closes. A show run under a code the
    association has since retired still renders its own program.

    Write through this model; *read* through AssociationStandardClass, which is
    the view over the open rows.
    """

    __tablename__ = "association_standard_class_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    show_type_id = Column(UUID(as_uuid=True), ForeignKey("show_types.id", ondelete="CASCADE"), nullable=False)
    code = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    division = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    source_year = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    effective_date = Column(Date, nullable=False, server_default=func.current_date())
    inactive_date = Column(Date, nullable=True)
    import_id = Column(UUID(as_uuid=True), ForeignKey("association_class_imports.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class AssociationStandardClass(Base):
    """Read-only mapping over the `association_standard_classes` VIEW.

    The view is `inactive_date IS NULL`. Reading it rather than the versions
    table is what keeps a retired code off the class pickers without every
    caller remembering the filter.
    """

    __tablename__ = "association_standard_classes"

    id = Column(UUID(as_uuid=True), primary_key=True)
    show_type_id = Column(UUID(as_uuid=True), nullable=False)
    code = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    division = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False)
    source_year = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    effective_date = Column(Date, nullable=False)


# The view is created by migration 114. Startup runs Base.metadata.create_all,
# and on a database where the migration has not run yet that would create a
# *table* under the view's name and then the migration's CREATE VIEW would
# fail. Dropping it from the metadata keeps it out of create_all entirely;
# the mapper holds its own reference to the Table, so queries are unaffected.
Base.metadata.remove(AssociationStandardClass.__table__)


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


class Futurity(Base):
    """A futurity program within a show (migration 107).

    Shaped after SidePot — a named program spanning several classes that
    exhibitors opt into — but a futurity entry is an *enrollment of a horse*
    rather than a bet on classes already entered. What it costs is derived:
    the tier rate times the horse's entries in `classes`, plus the office fee
    once, plus the late fee per class when the enrollment postdates the
    deadline. See `billing.futurity_lines`.

    Because the tier supplies the per-class price, a futurity class carries
    `entry_fee_cents = 0`. A non-zero fee on one double-charges.
    """
    __tablename__ = "futurities"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    entry_deadline = Column(Date, nullable=True)
    # Display precision on the deadline (migration 109). Lateness is still
    # decided by `entered_at` against `entry_deadline` - a 7:00 PM cutoff is
    # what the entry form prints, not a second clock for the biller to read.
    entry_deadline_time = Column(Time, nullable=True)
    entry_deadline_timezone = Column(Text, nullable=True)
    late_fee_cents = Column(Integer, nullable=False, server_default="0")
    office_fee_member_cents = Column(Integer, nullable=False, server_default="0")
    office_fee_nonmember_cents = Column(Integer, nullable=False, server_default="0")
    # The words on the published entry form (migration 109). Free text, because
    # they come from the club that runs the futurity: what it hands out, the
    # rules its classes run under, how the categories work, and what happens to
    # the money when a horse does not show.
    entry_instructions = Column(Text, nullable=True)
    award_notice = Column(Text, nullable=True)
    rules_notice = Column(Text, nullable=True)
    refund_policy = Column(Text, nullable=True)
    requires_horse_pedigree = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("show_id", "name", name="uq_futurities_show_name"),)

    show = relationship("Show", back_populates="futurities")
    fee_tiers = relationship(
        "FuturityFeeTier",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FuturityFeeTier.sort_order",
    )
    membership_options = relationship(
        "FuturityMembershipOption",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FuturityMembershipOption.sort_order",
    )
    waivers = relationship(
        "ShowWaiver",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ShowWaiver.sort_order",
    )
    futurity_classes = relationship(
        "FuturityClass",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    divisions = relationship(
        "FuturityDivision",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FuturityDivision.sort_order",
    )
    entries = relationship(
        "FuturityEntry",
        back_populates="futurity",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class FuturityFeeTier(Base):
    """What an entrant pays per class, by category (Category #1/#2/#3)."""
    __tablename__ = "futurity_fee_tiers"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    amount_cents = Column(Integer, nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint("futurity_id", "name", name="uq_futurity_fee_tiers_name"),
    )

    futurity = relationship("Futurity", back_populates="fee_tiers")


class FuturityMembershipOption(Base):
    """An optional club membership the futurity sells at entry (migration 109).

    Its own table rather than a `show_fees` row: the membership on a futurity
    entry form is priced by the futurity, bought at the moment of enrollment,
    and billed on the futurity line. A show fee would be reservable by anyone at
    the show and would leave "did this entrant join?" answerable in two places.

    Buying one is not the same fact as `FuturityEntry.is_member`, which decides
    which office fee applies - an entrant may already hold a card.
    """
    __tablename__ = "futurity_membership_options"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    amount_cents = Column(Integer, nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint(
            "futurity_id", "name", name="uq_futurity_membership_options_name"
        ),
        # Declared here as well as in the migration because `create_all` races
        # the migration on a new table and only ever creates whole tables — on a
        # database where the backend restarted first, the migration's
        # `CREATE TABLE IF NOT EXISTS` correctly did nothing and this model is
        # what the table actually looks like. See migration 110.
        CheckConstraint(
            "amount_cents >= 0", name="ck_futurity_membership_options_amount"
        ),
    )

    futurity = relationship("Futurity", back_populates="membership_options")


class FuturityClass(Base):
    __tablename__ = "futurity_classes"

    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), primary_key=True
    )
    class_id = Column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True
    )

    futurity = relationship("Futurity", back_populates="futurity_classes")
    class_ = relationship("Class", back_populates="futurity_classes")


class FuturityDivision(Base):
    """A Hi-Point award bracket within a futurity (Yearling, 2 Year Old).

    `scoring_method` reuses the side pot vocabulary deliberately: the app has
    no points table, so "hi-point" means lowest total placing or highest total
    score. Do not add a third scale without first deciding what a point is.
    """
    __tablename__ = "futurity_divisions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(Text, nullable=False)
    scoring_method = Column(Text, nullable=False, server_default="sum_placings")
    # What the champion and reserve actually receive (migration 109) - the
    # ranking is the computation, the saddle is the reason anybody entered.
    award_name = Column(Text, nullable=True)
    reserve_award_name = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint("futurity_id", "name", name="uq_futurity_divisions_name"),
        CheckConstraint(
            "scoring_method IN ('sum_placings','sum_scores')",
            name="futurity_divisions_scoring_method_check",
        ),
    )

    futurity = relationship("Futurity", back_populates="divisions")
    division_classes = relationship(
        "FuturityDivisionClass",
        back_populates="division",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class FuturityDivisionClass(Base):
    """Which classes count toward a Hi-Point division, and how.

    `counts` contributes the class's result outright. `best_of_group` makes the
    class compete with the others sharing its `group_name` for a single slot —
    the North Star rule that all three pleasure classes may be entered but only
    the best one counts.
    """
    __tablename__ = "futurity_division_classes"

    futurity_division_id = Column(
        UUID(as_uuid=True),
        ForeignKey("futurity_divisions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    class_id = Column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True
    )
    scoring = Column(Text, nullable=False, server_default="counts")
    group_name = Column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "scoring IN ('counts','best_of_group')",
            name="futurity_division_classes_scoring_check",
        ),
        CheckConstraint(
            "(scoring = 'counts' AND group_name IS NULL)"
            " OR (scoring = 'best_of_group' AND group_name IS NOT NULL)",
            name="ck_futurity_division_classes_group",
        ),
    )

    division = relationship("FuturityDivision", back_populates="division_classes")
    class_ = relationship("Class", back_populates="futurity_division_classes")


class FuturityEntry(Base):
    """One horse enrolled in one futurity, at one fee tier.

    `entered_at` is the day the enrollment was taken and is what decides the
    late fee — never today's date. Same rule as
    `show_entry_reservations.reserved_at`: pricing off "now" would apply a late
    fee retroactively to everyone the moment the deadline passed.
    """
    __tablename__ = "futurity_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), nullable=False
    )
    show_entry_id = Column(
        UUID(as_uuid=True), ForeignKey("show_entries.id", ondelete="CASCADE"), nullable=False
    )
    horse_id = Column(UUID(as_uuid=True), ForeignKey("horses.id", ondelete="SET NULL"), nullable=True)
    fee_tier_id = Column(
        UUID(as_uuid=True),
        ForeignKey("futurity_fee_tiers.id", ondelete="RESTRICT"),
        nullable=True,
    )
    is_member = Column(Boolean, nullable=False, server_default="false")
    # The membership bought with this entry, if any (migration 109). RESTRICT
    # for the same reason as `fee_tier_id`: an option somebody bought is a price
    # they were quoted, and deleting it would silently reprice their bill.
    membership_option_id = Column(
        UUID(as_uuid=True),
        ForeignKey("futurity_membership_options.id", ondelete="RESTRICT"),
        nullable=True,
    )
    # "Exhibitor if different than owner" - free text, because the person
    # showing a two-year-old is often a trainer or a youth with no account here.
    # Not `exhibitor_name`: every payload carrying this also carries the account
    # holder's name off `show_entry`, and one name for two people is how they
    # end up overwriting each other.
    shown_by_name = Column(Text, nullable=True)
    entered_at = Column(Date, nullable=False, server_default=func.current_date())
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("futurity_id", "horse_id", name="uq_futurity_entries_horse"),
    )

    futurity = relationship("Futurity", back_populates="entries")
    show_entry = relationship("ShowEntry", back_populates="futurity_entries")
    horse = relationship("Horse", lazy="selectin")
    fee_tier = relationship("FuturityFeeTier", lazy="selectin")
    membership_option = relationship("FuturityMembershipOption", lazy="selectin")


class SanctionedAssociationRequest(Base):
    """User-submitted request to add a new sanctioning body; admin reviews."""
    __tablename__ = "sanctioned_association_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    requested_name = Column(Text, nullable=False)
    requested_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    show_id = Column(
        UUID(as_uuid=True), ForeignKey("shows.id", ondelete="SET NULL"), nullable=True
    )
    status = Column(Text, nullable=False, server_default="pending")
    approved_association_id = Column(
        UUID(as_uuid=True),
        ForeignKey("associations.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    reviewed_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    requested_by = relationship("User", foreign_keys=[requested_by_user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id])
    approved_association = relationship("Association")


class ShowSanctioning(Base):
    """Per-show club sanctioning enrollment + per-class fee the secretary collects.

    Points at the shared `associations` registry (club rows), so "this show is
    NSBA-sanctioned" and "this rider is an NSBA member" reference the same body."""
    __tablename__ = "show_sanctioning"

    show_id = Column(
        UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), primary_key=True
    )
    association_id = Column(
        UUID(as_uuid=True),
        ForeignKey("associations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    per_class_fee_cents = Column(Integer, nullable=False, server_default="0")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", back_populates="sanctioning")
    association = relationship("Association", lazy="selectin")


class UserInvite(Base):
    """Email-invite tokens. Currently used by the Show Staff page to bring
    Scribes on board without a password set by the manager — the
    invitee sets their own password via the public /invite/{token} page."""
    __tablename__ = "user_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    token = Column(Text, nullable=False, unique=True)
    email = Column(Text, nullable=False)
    first_name = Column(Text, nullable=False)
    last_name = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    show_id = Column(
        UUID(as_uuid=True), ForeignKey("shows.id", ondelete="SET NULL"), nullable=True
    )
    status = Column(Text, nullable=False, server_default="pending")
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    invited_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    accepted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    accepted_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    show = relationship("Show", foreign_keys=[show_id])
    invited_by = relationship("User", foreign_keys=[invited_by_user_id])
    accepted_user = relationship("User", foreign_keys=[accepted_user_id])


class ShowWaiver(Base):
    """A document this show asks exhibitors to sign (migration 099).

    Entry blanks, liability releases, and venue rules are free text because the
    words come from the venue's insurer or the fair board, not from this app.
    `is_required` separates what an exhibitor cannot compete without from what
    the show wants read but does not chase.
    """

    __tablename__ = "show_waivers"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    is_required = Column(Boolean, nullable=False, server_default="true")
    # Scoped to one futurity, or NULL for show-wide (migration 109). The release
    # on a futurity entry form is asked of futurity entrants and nobody else;
    # asking everybody would leave a permanent outstanding item on the paperwork
    # of people who never entered it.
    futurity_id = Column(
        UUID(as_uuid=True), ForeignKey("futurities.id", ondelete="CASCADE"), nullable=True
    )
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    show = relationship("Show", back_populates="waivers")
    futurity = relationship("Futurity", back_populates="waivers")
    signatures = relationship(
        "ShowWaiverSignature", back_populates="waiver", cascade="all, delete-orphan"
    )


class ShowWaiverSignature(Base):
    """One exhibitor's signature on one waiver (migration 099).

    Both routes land here: the exhibitor typing their name during show sign-up,
    and staff recording a paper blank at the counter with `on_paper` set. One
    table because the fact recorded is the same either way, and because a show
    that runs entirely on paper still needs its outstanding count to work.

    `signed_name` is the one value here the app does not derive. A signature is
    a claim a person makes, not a fact the database already holds.
    """

    __tablename__ = "show_waiver_signatures"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    waiver_id = Column(
        UUID(as_uuid=True), ForeignKey("show_waivers.id", ondelete="CASCADE"), nullable=False
    )
    exhibitor_id = Column(
        UUID(as_uuid=True), ForeignKey("exhibitors.id", ondelete="CASCADE"), nullable=False
    )
    signed_name = Column(Text, nullable=False)
    # A release signed by a 12-year-old is not a release. Youth classes are a
    # third of a typical schedule, so this is not an edge case.
    signed_by_guardian = Column(Boolean, nullable=False, server_default="false")
    guardian_relationship = Column(Text, nullable=True)
    signed_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    on_paper = Column(Boolean, nullable=False, server_default="false")
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recorded_by_name = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("waiver_id", "exhibitor_id", name="uq_show_waiver_signatures"),
    )

    waiver = relationship("ShowWaiver", back_populates="signatures")
    exhibitor = relationship("Exhibitor")
