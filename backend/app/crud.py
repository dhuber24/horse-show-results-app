import uuid
from sqlalchemy.orm import Session
from sqlalchemy import select, delete, update
from .models import Class, Entry, Result

def list_classes(db: Session, show_id: uuid.UUID | None = None):
    stmt = select(Class).order_by(Class.class_date, Class.class_number)
    if show_id:
        stmt = stmt.where(Class.show_id == show_id)
    return db.execute(stmt).scalars().all()

def list_entries_for_class(db: Session, class_id: uuid.UUID):
    stmt = (
        select(Entry)
        .where(Entry.class_id == class_id)
        .order_by(Entry.back_number.nulls_last(), Entry.created_at)
    )
    return db.execute(stmt).scalars().all()

def get_class(db: Session, class_id: uuid.UUID) -> Class | None:
    return db.get(Class, class_id)

def get_results_for_class(db: Session, class_id: uuid.UUID):
    stmt = select(Result).where(Result.class_id == class_id).order_by(Result.placing, Result.created_at)
    return db.execute(stmt).scalars().all()

def replace_results_for_class(db: Session, class_id: uuid.UUID, new_results: list[dict]):
    # Simple & safe best-practice for MVP: delete and re-insert for the class
    db.execute(delete(Result).where(Result.class_id == class_id))

    objs = []
    for r in new_results:
        objs.append(Result(
            class_id=class_id,
            entry_id=r["entry_id"],
            placing=r["placing"],
            is_tie=r.get("is_tie", False),
            notes=r.get("notes")
        ))
    db.add_all(objs)
    db.commit()

def publish_class_results(db: Session, class_id: uuid.UUID):
    db.execute(
        update(Class)
        .where(Class.id == class_id)
        .values(status="RESULTS_POSTED")
    )
    db.commit()
