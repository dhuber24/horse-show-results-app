"""AQHA (American Quarter Horse Association) validation rules.

These checks intentionally cover only the AQHA requirements the app can verify
from current data. Deeper items, such as owner/lessee membership and per-judge
result reporting, need additional data modeling before they can be enforced.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from .default import DefaultRules


LEVEL_1_RE = re.compile(r"\s*-?\s*(LEVEL\s*1|LV1)\b", re.IGNORECASE)
JUNIOR_RE = re.compile(r"\b(JUNIOR|JR)\b", re.IGNORECASE)
SENIOR_RE = re.compile(r"\b(SENIOR|SR)\b", re.IGNORECASE)
TWO_YEAR_OLD_RE = re.compile(r"\b(TWO[-\s]?YEAR[-\s]?OLD|2[-\s]?YEAR[-\s]?OLD)\b", re.IGNORECASE)

HALTER_TERMS = {
    "STALLION",
    "STALLIONS",
    "MARE",
    "MARES",
    "GELDING",
    "GELDINGS",
    "BROODMARE",
    "BROODMARES",
    "HALTER",
    "PERFORMANCE HALTER",
}

RANCH_MINIMUM_AGE_TERMS = (
    "RANCH RIDING",
    "RANCH TRAIL",
    "VERSATILITY RANCH",
    "VRH",
)


class AQHARules(DefaultRules):
    code = "AQHA"

    def validate_entry(self, entry, show, cls, context=None):
        if getattr(entry, "status", "ENTERED") != "ENTERED":
            return []

        context = context or {}
        issues: list[dict[str, Any]] = []
        aqha_show_type_id = context.get("aqha_show_type_id") or getattr(show, "show_type_id", None)
        aqha_class = context.get("aqha_class")
        aqha_code = context.get("aqha_class_code") or self._aqha_class_code(cls, aqha_show_type_id)

        if not aqha_code:
            issues.append(self._issue(
                "error",
                "AQHA_CLASS_CODE_REQUIRED",
                "AQHA entries require an AQHA class code on the class.",
                class_id=getattr(cls, "id", None),
            ))
            return issues

        if aqha_class is None:
            issues.append(self._issue(
                "error",
                "AQHA_CLASS_CODE_UNKNOWN",
                f"AQHA class code {aqha_code} is not in the loaded AQHA standard class list.",
                class_id=getattr(cls, "id", None),
                class_code=aqha_code,
            ))
            return issues

        class_name = getattr(aqha_class, "name", None) or getattr(cls, "class_name", "")
        class_division = getattr(aqha_class, "division", None)
        horse = getattr(entry, "horse", None)
        exhibitor = getattr(entry, "exhibitor", None)

        if horse is None:
            issues.append(self._issue(
                "error",
                "AQHA_HORSE_REQUIRED",
                "AQHA entries require a horse.",
                class_id=getattr(cls, "id", None),
                class_code=aqha_code,
            ))
        elif not self._has_horse_registration(horse, aqha_show_type_id):
            issues.append(self._issue(
                "error",
                "AQHA_HORSE_REGISTRATION_REQUIRED",
                f"{getattr(horse, 'name', 'Horse')} needs an AQHA registration number on file.",
                class_id=getattr(cls, "id", None),
                class_code=aqha_code,
                horse_id=getattr(horse, "id", None),
            ))

        if exhibitor is None:
            issues.append(self._issue(
                "error",
                "AQHA_EXHIBITOR_REQUIRED",
                "AQHA entries require an exhibitor.",
                class_id=getattr(cls, "id", None),
                class_code=aqha_code,
            ))
        elif not self._has_exhibitor_registration(exhibitor, aqha_show_type_id):
            severity = "warning" if class_division == "Equestrians With Disabilities" else "error"
            issues.append(self._issue(
                severity,
                "AQHA_EXHIBITOR_MEMBERSHIP_REQUIRED",
                f"{getattr(exhibitor, 'full_name', 'Exhibitor')} needs an AQHA member number on file.",
                class_id=getattr(cls, "id", None),
                class_code=aqha_code,
                exhibitor_id=getattr(exhibitor, "id", None),
            ))

        if horse is not None:
            issues.extend(self._validate_horse_age(horse, show, cls, aqha_code, class_name))
            if class_division == "Youth" and getattr(horse, "sex", None) == "Stallion":
                issues.append(self._issue(
                    "error",
                    "AQHA_YOUTH_STALLION_RESTRICTED",
                    "Youth AQHA entries may not use stallions.",
                    class_id=getattr(cls, "id", None),
                    class_code=aqha_code,
                    horse_id=getattr(horse, "id", None),
                ))

        if exhibitor is not None:
            if class_division == "Youth":
                issues.extend(self._validate_youth_exhibitor(exhibitor, show, cls, aqha_code))
            if "SELECT" in class_name.upper():
                issues.extend(self._validate_select_exhibitor(exhibitor, show, cls, aqha_code))

        return issues

    def validate_show_schedule(self, show, classes, context=None):
        context = context or {}
        issues: list[dict[str, Any]] = []
        aqha_show_type_id = context.get("aqha_show_type_id") or getattr(show, "show_type_id", None)
        standard_by_code = context.get("standard_classes_by_code", {})

        if not getattr(show, "aqha_show_number", None):
            issues.append(self._issue(
                "warning",
                "AQHA_SHOW_NUMBER_MISSING",
                "AQHA show number is not set yet.",
            ))

        if getattr(show, "aqha_approval_status", "NOT_SUBMITTED") != "APPROVED":
            issues.append(self._issue(
                "warning",
                "AQHA_APPROVAL_NOT_MARKED_APPROVED",
                "AQHA approval status is not marked APPROVED.",
            ))

        qualified_staff = context.get("qualified_management_workshop_staff", [])
        if not qualified_staff:
            issues.append(self._issue(
                "warning",
                "AQHA_MANAGEMENT_WORKSHOP_REQUIRED",
                "Assign at least one show manager or show secretary with an AQHA show-management workshop date within 3 years of the show.",
            ))

        offered_non_level_one_keys: set[tuple[str, str]] = set()
        level_one_classes: list[tuple[Any, Any, str]] = []

        for cls in classes:
            aqha_code = self._aqha_class_code(cls, aqha_show_type_id)
            if not aqha_code:
                issues.append(self._issue(
                    "error",
                    "AQHA_CLASS_CODE_REQUIRED",
                    f"Class {getattr(cls, 'class_number', '')} needs an AQHA class code.",
                    class_id=getattr(cls, "id", None),
                ))
                continue

            aqha_class = standard_by_code.get(aqha_code)
            if aqha_class is None:
                issues.append(self._issue(
                    "error",
                    "AQHA_CLASS_CODE_UNKNOWN",
                    f"AQHA class code {aqha_code} is not in the loaded AQHA standard class list.",
                    class_id=getattr(cls, "id", None),
                    class_code=aqha_code,
                ))
                continue

            division = getattr(aqha_class, "division", "")
            name = getattr(aqha_class, "name", getattr(cls, "class_name", ""))
            key = (division, self._base_class_name(name))
            if self._is_level_one(name) and division in {"Amateur", "Youth"}:
                level_one_classes.append((cls, aqha_class, key))
            elif division in {"Amateur", "Youth"}:
                offered_non_level_one_keys.add(key)

        for cls, aqha_class, key in level_one_classes:
            if key not in offered_non_level_one_keys:
                issues.append(self._issue(
                    "warning",
                    "AQHA_LEVEL_1_CORRESPONDING_CLASS_MISSING",
                    f"Level 1 class {getattr(aqha_class, 'name', '')} should have the corresponding {key[0]} class on the schedule.",
                    class_id=getattr(cls, "id", None),
                    class_code=getattr(aqha_class, "code", None),
                ))

        return issues

    def _validate_horse_age(self, horse, show, cls, class_code, class_name):
        issues: list[dict[str, Any]] = []
        age = self._horse_age(horse, show)
        upper_name = class_name.upper()

        checks_age = (
            JUNIOR_RE.search(class_name)
            or SENIOR_RE.search(class_name)
            or any(term in upper_name for term in RANCH_MINIMUM_AGE_TERMS)
            or self._is_two_year_old_performance(class_name, getattr(cls, "class_date", None))
        )
        if checks_age and age is None:
            issues.append(self._issue(
                "error",
                "AQHA_HORSE_FOALING_DATE_REQUIRED",
                f"{getattr(horse, 'name', 'Horse')} needs a foaling date to verify AQHA age eligibility.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                horse_id=getattr(horse, "id", None),
            ))
            return issues

        if age is None:
            return issues

        if JUNIOR_RE.search(class_name) and age > 5:
            issues.append(self._issue(
                "error",
                "AQHA_JUNIOR_HORSE_AGE",
                f"{getattr(horse, 'name', 'Horse')} is {age}; AQHA junior classes are for horses 5 and under.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                horse_id=getattr(horse, "id", None),
            ))

        if SENIOR_RE.search(class_name) and age < 6:
            issues.append(self._issue(
                "error",
                "AQHA_SENIOR_HORSE_AGE",
                f"{getattr(horse, 'name', 'Horse')} is {age}; AQHA senior classes are for horses 6 and over.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                horse_id=getattr(horse, "id", None),
            ))

        if any(term in upper_name for term in RANCH_MINIMUM_AGE_TERMS) and age < 3:
            issues.append(self._issue(
                "error",
                "AQHA_RANCH_MINIMUM_AGE",
                f"{getattr(horse, 'name', 'Horse')} is {age}; AQHA ranch/VRH classes require horses to be at least 3.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                horse_id=getattr(horse, "id", None),
            ))

        class_date = getattr(cls, "class_date", None)
        if self._is_two_year_old_performance(class_name, class_date) and age == 2 and class_date.month < 7:
            issues.append(self._issue(
                "error",
                "AQHA_TWO_YEAR_OLD_PERFORMANCE_BEFORE_JULY",
                "AQHA 2-year-old performance classes may not be held before July 1.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                horse_id=getattr(horse, "id", None),
            ))

        return issues

    def _validate_youth_exhibitor(self, exhibitor, show, cls, class_code):
        age = self._calendar_year_age(getattr(exhibitor, "date_of_birth", None), show)
        if age is None:
            return [self._issue(
                "error",
                "AQHA_YOUTH_DOB_REQUIRED",
                f"{getattr(exhibitor, 'full_name', 'Exhibitor')} needs a date of birth to verify youth eligibility.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                exhibitor_id=getattr(exhibitor, "id", None),
            )]
        if age > 19:
            return [self._issue(
                "error",
                "AQHA_YOUTH_AGE",
                f"{getattr(exhibitor, 'full_name', 'Exhibitor')} is {age} by AQHA show-year age and is not youth eligible.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                exhibitor_id=getattr(exhibitor, "id", None),
            )]
        return []

    def _validate_select_exhibitor(self, exhibitor, show, cls, class_code):
        age = self._calendar_year_age(getattr(exhibitor, "date_of_birth", None), show)
        if age is None:
            return [self._issue(
                "error",
                "AQHA_SELECT_DOB_REQUIRED",
                f"{getattr(exhibitor, 'full_name', 'Exhibitor')} needs a date of birth to verify Select eligibility.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                exhibitor_id=getattr(exhibitor, "id", None),
            )]
        if age < 50:
            return [self._issue(
                "error",
                "AQHA_SELECT_AGE",
                f"{getattr(exhibitor, 'full_name', 'Exhibitor')} is {age}; AQHA Select classes require age 50 or older.",
                class_id=getattr(cls, "id", None),
                class_code=class_code,
                exhibitor_id=getattr(exhibitor, "id", None),
            )]
        return []

    def _aqha_class_code(self, cls, aqha_show_type_id):
        for assoc in getattr(cls, "associations", []) or []:
            show_type = getattr(assoc, "show_type", None)
            if (
                getattr(assoc, "show_type_id", None) == aqha_show_type_id
                or getattr(show_type, "code", "").upper() == "AQHA"
            ):
                return getattr(assoc, "association_class_code", None)
        return None

    def _has_horse_registration(self, horse, aqha_show_type_id):
        return any(
            getattr(reg, "show_type_id", None) == aqha_show_type_id
            and bool(getattr(reg, "registration_number", None))
            for reg in getattr(horse, "registrations", []) or []
        )

    def _has_exhibitor_registration(self, exhibitor, aqha_show_type_id):
        return any(
            getattr(reg, "show_type_id", None) == aqha_show_type_id
            and bool(getattr(reg, "member_number", None))
            for reg in getattr(exhibitor, "registrations", []) or []
        )

    def _horse_age(self, horse, show):
        return self._calendar_year_age(getattr(horse, "foaling_date", None), show)

    def _calendar_year_age(self, birth_date, show):
        if not birth_date:
            return None
        show_date = getattr(show, "start_date", None) or date.today()
        return max(0, show_date.year - birth_date.year)

    def _is_two_year_old_performance(self, class_name, class_date):
        if not class_date or not TWO_YEAR_OLD_RE.search(class_name):
            return False
        upper_name = class_name.upper()
        return not any(term in upper_name for term in HALTER_TERMS)

    def _is_level_one(self, class_name):
        return bool(LEVEL_1_RE.search(class_name))

    def _base_class_name(self, class_name):
        value = LEVEL_1_RE.sub("", class_name.upper())
        return re.sub(r"\s+", " ", value.replace("-", " ")).strip()

    def _issue(self, severity, code, message, **extra):
        issue = {"severity": severity, "code": code, "message": message}
        issue.update({key: str(value) for key, value in extra.items() if value is not None})
        return issue
