from pydantic import BaseModel
from typing import Optional

class MedicineResponse(BaseModel):
    purpose: Optional[str]
    dosage: Optional[str]
    side_effects: Optional[str]
    warnings: Optional[str]
    raw_output: Optional[str] = None
