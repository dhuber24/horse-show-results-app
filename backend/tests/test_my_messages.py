"""Who reads which shows' mail in the combined inbox (`routers/my_messages.py`).

The per-show inbox checks one show at a time. The combined one reads many, so
its scope is the whole access rule: an ADMIN reads every show, and a show
manager or secretary only the shows `show_access.worked_show_ids` names -- a
per-show row or membership of the company that runs the show. Get this wrong
and one club's secretary reads another club's mail.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from models import ShowContactMessage
from routers.my_messages import _scoped


def _sql(query) -> str:
    return str(query.compile(dialect=postgresql.dialect()))


def test_an_admin_reads_every_show():
    base = select(ShowContactMessage)
    assert _sql(_scoped(base, uuid.uuid4(), "ADMIN")) == _sql(base)


def test_a_show_manager_reads_only_the_shows_they_work():
    sql = _sql(_scoped(select(ShowContactMessage), uuid.uuid4(), "SHOW_MANAGER"))
    assert "show_contact_messages.show_id IN" in sql
    # Both routes onto a show: assigned to it, or in the company that runs it.
    assert "show_managers" in sql
    assert "show_company_members" in sql


def test_a_secretary_is_scoped_by_their_own_assignments():
    sql = _sql(_scoped(select(ShowContactMessage), uuid.uuid4(), "SHOW_SECRETARY"))
    assert "show_secretaries" in sql
    assert "show_company_members" in sql
