from fastapi import FastAPI, File, UploadFile, HTTPException
from services.vision_service import extract_text_from_image
from services.gpt_service import simplify_medical_text
from services.text_cleaner import clean_ocr_text
from models.response_model import MedicineResponse
import shutil
import os

app = FastAPI(title="Medicine Label Translator API")

UPLOAD_DIR = "temp"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.post("/analyze", response_model=MedicineResponse)
async def analyze_label(file: UploadFile = File(...)):
    try:
        # Save uploaded image
        file_path = f"{UPLOAD_DIR}/{file.filename}"
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Step 1: OCR
        raw_text = extract_text_from_image(file_path)

        if not raw_text:
            raise HTTPException(status_code=400, detail="No text detected")

        # Step 2: Clean text
        cleaned_text = clean_ocr_text(raw_text)

        # Step 3: GPT understanding
        result = simplify_medical_text(cleaned_text)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
