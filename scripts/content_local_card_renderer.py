"""CONTENT-owned, zero-credit typographic PNG renderer (editorial drafts only).

Produces actual local PNG bytes and decoded-pixel QA. No external image model,
provider receipt, authenticated approval, Buffer write or BCI audit is implied.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1350
VERSION = "content-local-card-pillow-v1"


def _text(value, maximum, label):
    if not isinstance(value, str) or not 2 <= len(value) <= maximum or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError(f"INVALID_{label}")
    return value


def _font(size):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def _lines(draw, value, font, max_width):
    result = []
    for paragraph in value.split("\n"):
        line = ""
        for word in paragraph.split():
            trial = f"{line} {word}" if line else word
            if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
                line = trial
            else:
                if not line:
                    raise ValueError("UNBREAKABLE_TEXT_TOO_WIDE")
                result.append(line)
                line = word
                if draw.textbbox((0, 0), line, font=font)[2] > max_width:
                    raise ValueError("UNBREAKABLE_TEXT_TOO_WIDE")
        if line:
            result.append(line)
    return result


def _fit(draw, value, max_width, max_height, start_size, min_size):
    for size in range(start_size, min_size - 1, -2):
        font = _font(size)
        try:
            lines = _lines(draw, value, font, max_width)
        except ValueError:
            continue
        line_height = int(size * 1.45)
        if len(lines) * line_height <= max_height:
            return font, lines, line_height
    raise ValueError("TEXT_DOES_NOT_FIT")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def render_cards(payload, output_dir):
    if not isinstance(payload, dict) or set(payload) != {"planId", "brandName", "cards"}:
        raise ValueError("INVALID_RENDER_PAYLOAD")
    if not isinstance(payload["planId"], str) or not re.fullmatch(r"content-plan-[0-9a-f]{64}", payload["planId"]):
        raise ValueError("INVALID_PLAN_ID")
    brand = _text(payload["brandName"], 60, "BRAND")
    cards = payload["cards"]
    if not isinstance(cards, list) or not 1 <= len(cards) <= 8:
        raise ValueError("INVALID_CARDS")
    validated = []
    for index, card in enumerate(cards, 1):
        if not isinstance(card, dict) or set(card) != {"slot", "title", "body", "accent"} or card["slot"] != index:
            raise ValueError("INVALID_CARD_SLOT")
        if card["accent"] not in ("gold", "teal", "blue"):
            raise ValueError("INVALID_ACCENT")
        validated.append((_text(card["title"], 110, "TITLE"), _text(card["body"], 520, "BODY"), card["accent"]))
    if len(set((title.casefold(), body.casefold()) for title, body, _ in validated)) != len(validated):
        raise ValueError("DUPLICATE_CARD_CONTENT")
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    palette = {"gold": "#E8C56A", "teal": "#79D4CB", "blue": "#9FBDF2"}
    records = []
    for index, (title, body, accent) in enumerate(validated, 1):
        image = Image.new("RGB", (WIDTH, HEIGHT), "#101827")
        draw = ImageDraw.Draw(image)
        ink = palette[accent]
        draw.rounded_rectangle((72, 78, 1008, 1272), radius=42, fill="#18253A", outline="#34445D", width=3)
        draw.rounded_rectangle((110, 125, 330, 136), radius=5, fill=ink)
        brand_font, brand_lines, brand_height = _fit(draw, brand, 780, 70, 39, 25)
        for j, line in enumerate(brand_lines):
            draw.text((112, 168 + j * brand_height), line, font=brand_font, fill=ink)
        title_font, title_lines, title_height = _fit(draw, title, 818, 320, 76, 38)
        y = 325
        for line in title_lines:
            draw.text((112, y), line, font=title_font, fill="#F6F2E8")
            y += title_height
        draw.rounded_rectangle((112, 715, 968, 719), radius=2, fill=ink)
        body_font, body_lines, body_height = _fit(draw, body, 808, 380, 42, 25)
        y = 756
        for line in body_lines:
            draw.text((116, y), line, font=body_font, fill="#D9E2ED")
            y += body_height
        draw.text((112, 1204), f"EDITORIAL DRAFT  |  {index:02d} / {len(validated):02d}", font=_font(22), fill="#9EACC0")
        path = out / f"content_card_{index:02d}.png"
        image.save(path, format="PNG", optimize=False)
        data = path.read_bytes()
        with Image.open(path) as decoded:
            decoded.load()
            if decoded.size != (WIDTH, HEIGHT) or decoded.mode != "RGB":
                raise ValueError("RENDERED_MEDIA_QA_FAILED")
            pixel_hash = _sha(decoded.tobytes())
        records.append({"slot": index, "filename": path.name, "byteLength": len(data), "sourceSha256": _sha(data), "decodedRgbSha256": pixel_hash})
    if len(set(r["decodedRgbSha256"] for r in records)) != len(records):
        raise ValueError("DUPLICATE_RENDERED_PIXELS")
    manifest = {"schemaVersion": 1, "renderer": VERSION, "planId": payload["planId"], "planIdAuthenticated": False,
                "status": "LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING", "localMediaBytesDecoded": True,
                "externalAiProviderGenerationVerified": False, "providerReceiptAuthenticated": False,
                "editorialApprovalVerified": False, "bufferSentVerified": False, "sharedBciAuditVerified": False,
                "executionAllowed": False, "customerSaasReady": False, "images": records}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    result = render_cards(json.loads(args.input_json.read_text(encoding="utf-8")), args.output_dir)
    print(json.dumps({"status": result["status"], "count": len(result["images"]), "manifest": str(args.output_dir / "manifest.json")}))


if __name__ == "__main__":
    main()
