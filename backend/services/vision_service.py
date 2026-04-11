from google.cloud import vision

def extract_text_from_image(image_path: str) -> str:
    client = vision.ImageAnnotatorClient()

    with open(image_path, "rb") as image_file:
        content = image_file.read()

    image = vision.Image(content=content)
    response = client.text_detection(image=image)

    texts = response.text_annotations

    if not texts:
        return ""

    return texts[0].description
