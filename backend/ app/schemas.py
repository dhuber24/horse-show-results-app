import uuid
from datetime import date
from pydantic import BaseModel, Field

class ClassOut(BaseModel):
    id: uuid.UUID
    class_number: str
    class_name: str
    class_date: date
    status: str
    ring_id: uuid.UUID | None = None
    division_id: uuid.UUID | None = None

class EntryOut(BaseModel):
    id: uuid.UUID
    back_number: int | None
    status: str
    rider_name: str
    horse_name: str
    owner_name: str | None = None

class ResultIn(BaseModel):
    entry_id: uuid.UUID
    placing: int = Field(gt=0)
    is_tie: bool = False
    notes: str | None = None

class ResultsUpsertIn(BaseModel):
    results: list[ResultIn]

class ResultOut(BaseModel):
    entry_id: uuid.UUID
    placing: int
    is_tie: bool
    notes: str | None = None
    back_number: int | None = None
    rider_name: str
    horse_name: str
