"""What a show must give a waiver before the desk can track it.

A title and nothing else. Plenty of shows hand out a paper release and only want
the desk to tick off who has signed it; asking them to paste wording they do not
have in hand stopped them adding the waiver at all.
"""
import pytest
from pydantic import ValidationError

from schemas import ShowWaiverCreate, ShowWaiverUpdate


def test_a_title_alone_is_a_waiver():
    waiver = ShowWaiverCreate(title="Release of liability")
    # "" rather than None: the column is NOT NULL, and no wording is not
    # missing wording.
    assert waiver.body == ""


def test_a_waiver_still_needs_a_title():
    with pytest.raises(ValidationError):
        ShowWaiverCreate(title="")


def test_the_wording_can_be_cleared_on_an_existing_waiver():
    assert ShowWaiverUpdate(body="").body == ""
