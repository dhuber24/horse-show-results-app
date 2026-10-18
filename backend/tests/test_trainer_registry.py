"""The Trainer Registry (`trainer_registry.py`, `zip_locations.py`).

What these pin: what each plan shows -- Basic a name, what they train and where;
Pro everything -- and that nothing private ever reaches either; that Pro is a
paid-through date, not a switch; the order a visitor sees (Pro nearest-first,
then Basic in name order); what a listing needs at sign-up; and the emails to
the admins and to the trainer.
"""
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from routers.auth import TrainerRegister
from schemas import TrainerPublicOut
from trainer_registry import (
    ListingMedia,
    background_check_current,
    clean_disciplines,
    is_listed,
    is_pro,
    lead_email,
    lead_recipient,
    listing_email,
    listing_problem,
    pro_request_email,
    public_card,
    rank_listings,
    safesport_current,
    unknown_disciplines,
    video_links_problem,
)
from zip_locations import miles_between, normalize_zip, valid_coordinates, zip_location

TODAY = date(2026, 10, 16)


def _signup(**overrides) -> TrainerRegister:
    fields = {
        "email": "jane@example.com",
        "password": "correct-horse",
        "first_name": "Jane",
        "last_name": "Smith",
        "private_phone": "555-123-4567",
    }
    fields.update(overrides)
    return TrainerRegister(**fields)


def _listing_fields(**overrides) -> dict:
    fields = {
        "list_in_registry": True,
        "city": "Gainesville",
        "state": "FL",
        "zip_code": "32601",
        "disciplines": ["Reining"],
    }
    fields.update(overrides)
    return fields


def _trainer(**overrides):
    fields = {
        "id": uuid.uuid4(),
        "first_name": "Jane",
        "last_name": "Smith",
        "name": "Jane Smith",
        "business_name": "Smith Performance Horses",
        "city": "Ocala",
        "state": "FL",
        "country": "US",
        "zip_code": "34470",
        "disciplines": ["Reining", "Ranch Riding"],
        "website": "https://smith.example.com",
        "bio": "Reining and ranch riding.",
        "email": "barn@example.com",
        "phone": "555-987-6543",
        "private_phone": "555-000-0000",
        "social_facebook": "smithhorses",
        "social_instagram": None,
        "social_tiktok": None,
        "video_urls": ["https://youtube.com/watch?v=abc"],
        "rate_sheet": [{"service": "Full training", "price": "$1,200 / month", "details": None}],
        "safesport_completed_at": None,
        "background_check_expires_at": None,
        "has_liability_insurance": True,
        "is_public": True,
        "pro_until": None,
        "pro_plan": None,
        "user": SimpleNamespace(is_approved=True, email="jane@example.com"),
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _pro(**overrides):
    return _trainer(pro_until=date(2027, 1, 31), pro_plan="monthly", **overrides)


def _affiliation(trainer_id, code="AQHA", expires_at=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        trainer_id=trainer_id,
        association_id=uuid.uuid4(),
        association=SimpleNamespace(code=code, name=f"{code} name", association_type="breed"),
        member_number="12345",
        status="professional",
        expires_at=expires_at,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


# ── What a listing needs ───────────────────────────────────────────────────────


def test_a_listing_with_a_town_zip_and_discipline_is_complete():
    assert listing_problem("Ocala", "FL", "34470", ["Reining"]) is None
    assert listing_problem("Ocala", "FL", "34470-1234", ["Reining"]) is None


def test_a_listing_needs_a_town_and_state():
    assert "town and state" in listing_problem("", "FL", "34470", ["Reining"])
    assert "town and state" in listing_problem("Ocala", " ", "34470", ["Reining"])


def test_a_listing_needs_a_zip_code():
    assert "zip code" in listing_problem("Ocala", "FL", "", ["Reining"])
    assert "zip code" in listing_problem("Ocala", "FL", "3447", ["Reining"])


def test_a_listing_needs_a_discipline():
    assert "discipline" in listing_problem("Ocala", "FL", "34470", [])


def test_a_zip_the_map_does_not_know_can_still_be_listed():
    # 00000 is not a ZCTA: the trainer is listed, just not placed on the map.
    assert zip_location("00000") is None
    assert listing_problem("Nowhere", "FL", "00000", ["Reining"]) is None


# ── The sign-up form's boxes ───────────────────────────────────────────────────


def test_signing_up_without_listing_needs_nothing_extra():
    body = _signup()
    assert body.list_in_registry is False
    assert body.disciplines == []


def test_signing_up_to_be_listed_with_a_complete_listing_is_accepted():
    assert _signup(**_listing_fields()).list_in_registry is True


def test_signing_up_to_be_listed_without_a_zip_is_refused():
    with pytest.raises(ValidationError, match="zip code"):
        _signup(**_listing_fields(zip_code=None))


def test_signing_up_to_be_listed_without_a_discipline_is_refused():
    with pytest.raises(ValidationError, match="discipline"):
        _signup(**_listing_fields(disciplines=[]))


def test_a_discipline_not_on_the_list_is_refused():
    with pytest.raises(ValidationError, match="Basket Weaving"):
        _signup(**_listing_fields(disciplines=["Reining", "Basket Weaving"]))


def test_disciplines_come_back_once_each_in_the_lists_order():
    assert clean_disciplines(["Trail", "Reining", "Trail"]) == ["Reining", "Trail"]
    assert unknown_disciplines(["Reining", "Polo"]) == ["Polo"]


def test_video_links_must_be_web_addresses():
    assert video_links_problem(["https://youtube.com/watch?v=abc"]) is None
    assert "not a web address" in video_links_problem(["javascript:alert(1)"])
    assert "up to 5" in video_links_problem([f"https://v.example.com/{i}" for i in range(6)])


# ── Who is listed, and on which plan ───────────────────────────────────────────


def test_a_trainer_who_opted_in_is_listed():
    assert is_listed(_trainer())


def test_a_trainer_who_did_not_opt_in_is_not_listed():
    assert not is_listed(_trainer(is_public=False))


def test_a_locked_account_comes_off_the_registry():
    assert not is_listed(_trainer(user=SimpleNamespace(is_approved=False)))


def test_a_registry_row_with_no_account_can_be_listed():
    assert is_listed(_trainer(user=None))


def test_pro_runs_through_its_paid_through_date_and_no_further():
    assert is_pro(_trainer(pro_until=TODAY), TODAY)
    assert not is_pro(_trainer(pro_until=date(2026, 10, 15)), TODAY)
    assert not is_pro(_trainer(), TODAY)


# ── What each plan shows ───────────────────────────────────────────────────────


def test_basic_shows_a_name_what_they_train_and_where_and_nothing_more():
    trainer = _trainer()
    card = public_card(
        trainer,
        [_affiliation(trainer.id)],
        ListingMedia(headshot_id=uuid.uuid4(), photo_ids=(uuid.uuid4(),)),
        today=TODAY,
    )
    assert card.tier == "basic"
    assert (card.name, card.business_name, card.city, card.state) == (
        "Jane Smith", "Smith Performance Horses", "Ocala", "FL",
    )
    assert card.disciplines == ["Reining", "Ranch Riding"]
    empty = TrainerPublicOut(id=trainer.id, first_name="", last_name="", name="")
    for field in (
        "bio", "website", "public_phone", "public_email", "social_facebook", "headshot_id", "logo_id",
        "photo_ids", "video_urls", "rate_sheet", "can_contact", "affiliations",
        "safesport_current", "has_liability_insurance",
    ):
        assert getattr(card, field) == getattr(empty, field), field


def test_pro_shows_the_rich_profile_and_takes_leads():
    trainer = _pro()
    logo = uuid.uuid4()
    card = public_card(trainer, [], ListingMedia(logo_id=logo), today=TODAY)
    assert card.tier == "pro"
    assert card.bio == "Reining and ranch riding."
    assert card.public_phone == "555-987-6543"
    assert card.logo_id == logo
    assert card.video_urls == ["https://youtube.com/watch?v=abc"]
    assert card.rate_sheet[0].service == "Full training"
    assert card.can_contact is True
    assert card.has_liability_insurance is True


def test_no_plan_shows_the_private_contact_or_the_zip():
    for trainer in (_trainer(), _pro()):
        dumped = public_card(trainer, [], ListingMedia(), today=TODAY).model_dump_json()
        assert "555-000-0000" not in dumped
        assert "jane@example.com" not in dumped  # the login email
        assert "34470" not in dumped


def test_only_pro_shows_the_public_email():
    assert public_card(_pro(), [], ListingMedia(), today=TODAY).public_email == "barn@example.com"
    dumped = public_card(_trainer(), [], ListingMedia(), today=TODAY).model_dump_json()
    assert "barn@example.com" not in dumped


def test_a_lapsed_card_is_left_off_a_pro_listing():
    trainer = _pro()
    cards = [
        _affiliation(trainer.id, "AQHA", expires_at=date(2027, 1, 1)),
        _affiliation(trainer.id, "NSBA", expires_at=None),
        _affiliation(trainer.id, "APHA", expires_at=date(2026, 3, 1)),
    ]
    card = public_card(trainer, cards, ListingMedia(), today=TODAY)
    assert [a.association_code for a in card.affiliations] == ["AQHA", "NSBA"]


def test_compliance_shows_as_current_or_not_never_as_dates():
    card = public_card(
        _pro(safesport_completed_at=date(2026, 2, 1), background_check_expires_at=date(2026, 10, 1)),
        [],
        ListingMedia(),
        today=TODAY,
    )
    assert card.safesport_current is True
    assert card.background_check_current is False
    assert "safesport_completed_at" not in card.model_dump()


def test_safesport_is_good_for_a_year_from_completion():
    assert safesport_current(date(2025, 10, 16), TODAY)
    assert not safesport_current(date(2025, 10, 15), TODAY)
    assert not safesport_current(None, TODAY)


def test_a_background_check_is_current_through_its_expiry_day():
    assert background_check_current(TODAY, TODAY)
    assert not background_check_current(date(2026, 10, 15), TODAY)


# ── In what order ──────────────────────────────────────────────────────────────

GAINESVILLE = (29.6487, -82.3254)  # 32601
OCALA = (29.1872, -82.1401)
JACKSONVILLE = (30.3322, -81.6557)
DALLAS = (32.7767, -96.7970)


def _card(name: str, tier: str) -> TrainerPublicOut:
    return TrainerPublicOut(id=uuid.uuid4(), first_name=name, last_name="", name=name, tier=tier)


def _names(cards):
    return [c.name for c in cards]


def test_with_nowhere_to_search_from_pro_comes_first_then_basic_in_name_order():
    entries = [
        (_card("Adams", "basic"), OCALA),
        (_card("Baker", "pro"), DALLAS),
        (_card("Clark", "basic"), None),
        (_card("Davis", "pro"), OCALA),
    ]
    ranked = rank_listings(entries, origin=None, radius_miles=None)
    assert _names(ranked) == ["Baker", "Davis", "Adams", "Clark"]
    assert all(c.distance_miles is None for c in ranked)


def test_near_me_ranks_pro_nearest_first_and_basic_below_without_distance():
    entries = [
        (_card("Adams", "basic"), OCALA),         # nearest of all, but Basic
        (_card("Baker", "pro"), JACKSONVILLE),
        (_card("Clark", "pro"), OCALA),
        (_card("Davis", "pro"), None),           # Pro the map cannot place
        (_card("Evans", "basic"), DALLAS),
    ]
    ranked = rank_listings(entries, origin=GAINESVILLE, radius_miles=None)
    assert _names(ranked) == ["Clark", "Baker", "Davis", "Adams", "Evans"]
    assert ranked[0].distance_miles == pytest.approx(34, abs=2)
    assert ranked[1].distance_miles == pytest.approx(62, abs=2)  # as the crow flies
    assert ranked[2].distance_miles is None
    assert ranked[3].distance_miles is None  # distance is Pro's


def test_a_radius_narrows_both_plans_and_drops_whoever_cannot_be_placed():
    entries = [
        (_card("Adams", "basic"), OCALA),
        (_card("Baker", "pro"), JACKSONVILLE),
        (_card("Clark", "pro"), DALLAS),
        (_card("Davis", "pro"), None),
        (_card("Evans", "basic"), DALLAS),
    ]
    ranked = rank_listings(entries, origin=GAINESVILLE, radius_miles=100)
    assert _names(ranked) == ["Baker", "Adams"]


# ── Where a zip code is ────────────────────────────────────────────────────────


def test_a_zip_code_is_read_in_its_usual_spellings():
    assert normalize_zip("32601") == "32601"
    assert normalize_zip(" 32601-1234 ") == "32601"
    assert normalize_zip("326011234") == "32601"
    assert normalize_zip("3260") is None
    assert normalize_zip("ABCDE") is None
    assert normalize_zip(None) is None


def test_a_known_zip_is_on_the_map():
    lat, lon = zip_location("32601")
    assert lat == pytest.approx(29.65, abs=0.05)
    assert lon == pytest.approx(-82.33, abs=0.05)


def test_distance_is_in_miles():
    assert miles_between(GAINESVILLE, DALLAS) == pytest.approx(900, abs=30)
    assert miles_between(OCALA, OCALA) == 0


def test_browser_coordinates_must_be_on_the_globe():
    assert valid_coordinates(29.6, -82.3) == (29.6, -82.3)
    assert valid_coordinates(91, 0) is None
    assert valid_coordinates(None, -82.3) is None


# ── Email ──────────────────────────────────────────────────────────────────────


def test_the_admins_are_told_who_wants_listing_and_where_to_look():
    trainer = _trainer()
    subject, body = listing_email(trainer, "jane@example.com", at_signup=True)

    assert subject == "Trainer Registry: Jane Smith (Smith Performance Horses) wants to be listed"
    assert "signed up as a trainer and ticked" in body
    assert "on Basic" in body
    assert "Disciplines: Reining, Ranch Riding" in body
    assert "Login email: jane@example.com" in body
    assert f"/trainers/{trainer.id}" in body
    assert f"/admin/trainers/{trainer.id}" in body
    assert "Replying to this email goes to jane@example.com." in body


def test_turning_it_on_later_says_so():
    _, body = listing_email(_trainer(), "jane@example.com", at_signup=False)
    assert "turned on" in body
    assert "signed up" not in body


def test_a_subject_is_one_line_whatever_the_business_name_says():
    trainer = _trainer(business_name="Smith\r\nBcc: everyone@example.com")
    for subject, _ in (
        listing_email(trainer, "jane@example.com", at_signup=True),
        pro_request_email(trainer, "monthly", "jane@example.com"),
    ):
        assert "\n" not in subject and "\r" not in subject


def test_a_registry_row_with_no_account_has_nobody_to_reply_to():
    _, body = listing_email(_trainer(user=None, business_name=None), None, at_signup=False)
    assert "Login email: (no account)" in body
    assert "Replying to" not in body


def test_a_pro_request_tells_the_admins_what_to_do_about_it():
    trainer = _trainer()
    subject, body = pro_request_email(trainer, "annual", "jane@example.com")
    assert subject == "Trainer Registry Pro: Jane Smith (Smith Performance Horses) asked for Pro, annual"
    assert "bill them outside the app" in body
    assert f"/admin/trainers/{trainer.id}" in body


def test_a_lead_reaches_the_trainer_with_the_senders_details():
    lead = SimpleNamespace(
        sender_name="Pat\r\nRider", sender_email="pat@example.com", sender_phone="555-111-2222",
        message="Do you take youth riders?",
    )
    subject, body = lead_email(_pro(), lead)
    assert "\n" not in subject and "\r" not in subject
    assert "Do you take youth riders?" in body
    assert "Phone: 555-111-2222" in body
    assert "Replying to this email goes to pat@example.com" in body
    assert "/profile/registry" in body


def test_a_lead_goes_to_the_public_email_or_else_the_login():
    assert lead_recipient(_pro()) == "barn@example.com"
    assert lead_recipient(_pro(email=None)) == "jane@example.com"
    assert lead_recipient(_pro(email=None, user=None)) is None
