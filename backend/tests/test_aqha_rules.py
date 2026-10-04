"""AQHA horse-age checks (SHW112.6 / SHW112.7).

A missing foaling date is a flag the desk can clear, not a refusal: the
exhibitor's own registration must not be turned away over paperwork somebody
at the counter can produce. A known age that is out of range still refuses.
"""
from datetime import date

from rules.aqha import AQHARules
from tests.factories import make_class, make_horse, make_show


def _age_issues(class_name, foaled):
    show = make_show(start_date=date(2026, 6, 1))
    cls = make_class(class_name=class_name)
    horse = make_horse(foaling_date=foaled)
    return AQHARules()._validate_horse_age(horse, show, cls, None, class_name)


def test_a_missing_foaling_date_is_a_warning_not_a_refusal():
    issues = _age_issues("Junior Western Pleasure", None)
    assert [(i["severity"], i["code"]) for i in issues] == [
        ("warning", "AQHA_HORSE_FOALING_DATE_REQUIRED"),
    ]


def test_a_known_age_out_of_range_still_refuses():
    issues = _age_issues("Junior Western Pleasure", date(2018, 4, 1))
    assert [(i["severity"], i["code"]) for i in issues] == [
        ("error", "AQHA_JUNIOR_HORSE_AGE"),
    ]
