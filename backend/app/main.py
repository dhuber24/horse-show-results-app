import uuid
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from . import crud
from .schemas import ClassOut, EntryOut, ResultsUpsertIn, ResultOut

app = FastAPI(title="Horse Show Placings API", version="0.1.0")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/classes", response_model=list[ClassOut])
def api_list_classes(show_id: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return crud.list_classes(db, show_id=show_id)

@app.get("/classes/{class_id}/entries", response_model=list[EntryOut])
def api_list_entries(class_id: uuid.UUID, db: Session = Depends(get_db)):
    c = crud.get_class(db, class_id)
    if not c:
        raise HTTPException(status_code=404, detail="Class not found")

    entries = crud.list_entries_for_class(db, class_id)

    return [
        EntryOut(
            id=e.id,
            back_number=e.back_number,
            status=e.status,
            rider_name=e.rider.full_name,
            horse_name=e.horse.name,
            owner_name=e.horse.owner_name
        )
        for e in entries
    ]

@app.get("/classes/{class_id}/results", response_model=list[ResultOut])
def api_get_results(class_id: uuid.UUID, db: Session = Depends(get_db)):
    c = crud.get_class(db, class_id)
    if not c:
        raise HTTPException(status_code=404, detail="Class not found")

    results = crud.get_results_for_class(db, class_id)

    return [
        ResultOut(
            entry_id=r.entry_id,
            placing=r.placing,
            is_tie=r.is_tie,
            notes=r.notes,
            back_number=r.entry.back_number,
            rider_name=r.entry.rider.full_name,
            horse_name=r.entry.horse.name,
        )
        for r in results
    ]

@app.post("/classes/{class_id}/results")
def api_save_results(class_id: uuid.UUID, payload: ResultsUpsertIn, db: Session = Depends(get_db)):
    c = crud.get_class(db, class_id)
    if not c:
        raise HTTPException(status_code=404, detail="Class not found")

    # Basic validation: all entry_ids must belong to this class
    class_entry_ids = {e.id for e in crud.list_entries_for_class(db, class_id)}
    for r in payload.results:
        if r.entry_id not in class_entry_ids:
            raise HTTPException(status_code=400, detail=f"Entry {r.entry_id} does not belong to class {class_id}")

    # Optional best-practice constraint: prevent saving results for closed classes
    if c.status == "CLOSED":
        raise HTTPException(status_code=400, detail="Class is closed; cannot save results")

    crud.replace_results_for_class(
        db,
        class_id,
        [r.model_dump() for r in payload.results]
    )

    return {"ok": True, "saved": len(payload.results)}

@app.post("/classes/{class_id}/publish")
def api_publish_results(class_id: uuid.UUID, db: Session = Depends(get_db)):
    c = crud.get_class(db, class_id)
    if not c:
        raise HTTPException(status_code=404, detail="Class not found")

    crud.publish_class_results(db, class_id)
    return {"ok": True, "status": "RESULTS_POSTED"}
