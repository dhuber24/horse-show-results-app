"""The stall and RV maps (migration 182) are `show_documents` rows, so every
type the router writes has to be one the table's CHECK accepts -- a type left
out of either fails only at upload time, as a 500."""
from pathlib import Path

from sqlalchemy import CheckConstraint

from models import ShowDocument
from routers.show_documents import MAP_NAMES, MAP_TYPES, SHOWBILL

MIGRATION = Path(__file__).resolve().parents[2] / "database" / "migrations" / "182_show_maps.sql"


def _model_check() -> str:
    column = ShowDocument.__table__.c.document_type
    checks = [c for c in column.constraints if isinstance(c, CheckConstraint)]
    assert len(checks) == 1
    return str(checks[0].sqltext)


def test_every_map_type_is_allowed_by_the_model():
    check = _model_check()
    for doc_type in [SHOWBILL, *MAP_TYPES.values()]:
        assert f"'{doc_type}'" in check


def test_every_map_type_is_allowed_by_the_migration():
    if not MIGRATION.exists():  # the backend is mounted alone in Docker
        return
    sql = MIGRATION.read_text()
    for doc_type in [SHOWBILL, *MAP_TYPES.values()]:
        assert f"'{doc_type}'" in sql


def test_each_kind_has_a_name_for_its_messages():
    assert MAP_NAMES.keys() == MAP_TYPES.keys()
