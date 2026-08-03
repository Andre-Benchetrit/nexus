from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf import PdfReader


CID_RE = re.compile(
    r"(?i)\bCI[D0O](?:\s*[-.:º°]?\s*(?:10|11))?(?:\s*N\s*[^A-Z0-9]{0,4})?"
    r"[^A-Z0-9]{0,10}([A-Z][0-9O]{2}(?:[.\-]?[0-9A-Z]{1,2})?)\b"
)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def person_from_filename(path: Path) -> str:
    stem = path.stem
    dated = re.match(r"^\d{4}-\d{2}-\d{2}\s*[-_ ]+(.+?)(?:\s*[-_ ]+\d+\s*(?:dia|dias|hora|horas)\b.*)?$", stem, re.I)
    if dated:
        stem = dated.group(1)
    stem = re.sub(r"(?i)^atestado\s*[-_ ]*", "", stem)
    stem = re.sub(r"(?i)^ok\s*[-_ ]*", "", stem)
    stem = re.sub(r"\s*[-_ ]*\d{1,2}[-_.]\d{1,2}(?:[-_.]\d{2,4})?.*$", "", stem)
    stem = re.sub(r"\s+\d{1,2}[-_.]\d{1,2}(?:[-_.]\d{2,4})?.*$", "", stem)
    stem = re.sub(r"\s*\([^)]*\)\s*\d*$", "", stem)
    return re.sub(r"\s+", " ", stem.replace("_", " ").strip(" -_"))


def normalize_cid(raw: str) -> str:
    cid = raw.upper().replace("-", ".").replace("O", "0")
    if "." not in cid and len(cid) > 3:
        cid = cid[:3] + "." + cid[3:]
    return cid


def extract_cids(text: str) -> list[str]:
    found: list[str] = []
    # Only accept codes explicitly tied to a CID label, avoiding OCR false positives.
    for m in CID_RE.finditer(text):
        cid = normalize_cid(m.group(1))
        if re.fullmatch(r"[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?", cid) and cid not in found:
            found.append(cid)
    return found


def pdf_text(path: Path) -> str:
    try:
        return "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages)
    except Exception:
        return ""


def preprocess(source: Path, target: Path) -> None:
    with Image.open(source) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        if max(im.size) < 2400:
            scale = 2400 / max(im.size)
            im = im.resize((int(im.width * scale), int(im.height * scale)))
        im = ImageOps.autocontrast(im)
        im = ImageEnhance.Contrast(im).enhance(1.35)
        im = im.filter(ImageFilter.SHARPEN)
        im.save(target, "PNG")


def ocr_image(path: Path, tesseract: Path, temp: Path, tessdata: Path | None = None) -> str:
    prepared = temp / (path.stem + "_prep.png")
    preprocess(path, prepared)
    outputs = []
    for psm in (6, 11):
        cmd = [str(tesseract), str(prepared), "stdout"]
        if tessdata:
            cmd.extend(["--tessdata-dir", str(tessdata)])
        cmd.extend(["-l", "por+eng", "--psm", str(psm), "quiet"])
        run = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        outputs.append(run.stdout)
        if extract_cids(run.stdout):
            break
    return "\n".join(outputs)


def render_pdf(path: Path, temp: Path, pdftoppm: str) -> list[Path]:
    prefix = temp / "page"
    subprocess.run([pdftoppm, "-r", "220", "-jpeg", str(path), str(prefix)], capture_output=True, check=True)
    return sorted(temp.glob("page-*.jpg"))


def process_one(path: Path, root: Path, tesseract: Path, pdftoppm: str, tessdata: Path | None) -> dict:
    result = {
        "pessoa": person_from_filename(path), "cid": "", "arquivo": path.name,
        "pasta": str(path.parent.relative_to(root)), "caminho": str(path),
        "metodo": "", "status": "", "trecho": ""
    }
    try:
        with tempfile.TemporaryDirectory(prefix="ocr_atestado_") as td:
            temp = Path(td)
            if path.suffix.lower() == ".pdf":
                text = pdf_text(path)
                method = "texto do PDF"
                cids = extract_cids(text)
                if not cids:
                    pages = render_pdf(path, temp, pdftoppm)
                    text = "\n".join(ocr_image(p, tesseract, temp, tessdata) for p in pages)
                    method = "OCR do PDF"
            elif path.suffix.lower() in IMAGE_EXTS:
                text = ocr_image(path, tesseract, temp, tessdata)
                method = "OCR da imagem"
            else:
                result.update(status="Formato não processado", metodo="ignorado")
                return result
        cids = extract_cids(text)
        result["cid"] = ", ".join(cids)
        result["metodo"] = method
        result["status"] = "CID encontrado" if cids else "Revisar - CID não localizado"
        match = re.search(r"(?i).{0,35}CID.{0,55}", re.sub(r"\s+", " ", text))
        result["trecho"] = match.group(0).strip() if match else ""
    except Exception as exc:
        result.update(status="Erro no processamento", metodo="erro", trecho=str(exc)[:180])
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--tesseract", type=Path, required=True)
    ap.add_argument("--pdftoppm", default="pdftoppm")
    ap.add_argument("--tessdata", type=Path)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    root = args.root.resolve()
    files = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS | {".pdf"}]
    # ZIPs are reported separately; originals remain untouched.
    zip_rows = []
    for z in root.rglob("*.zip"):
        try:
            with zipfile.ZipFile(z) as archive:
                names = [n for n in archive.namelist() if Path(n).suffix.lower() in IMAGE_EXTS | {".pdf"}]
                zip_rows.append({"arquivo": z.name, "pasta": str(z.parent.relative_to(root)), "itens_suportados": len(names)})
        except Exception:
            zip_rows.append({"arquivo": z.name, "pasta": str(z.parent.relative_to(root)), "itens_suportados": -1})
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_one, p, root, args.tesseract, args.pdftoppm, args.tessdata): p for p in files}
        for i, future in enumerate(as_completed(futures), 1):
            rows.append(future.result())
            if i % 10 == 0:
                print(f"Processados {i}/{len(files)}", flush=True)
    rows.sort(key=lambda r: (r["pasta"], r["arquivo"].lower()))
    payload = {"total": len(rows), "resultados": rows, "zips": zip_rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"total": len(rows), "com_cid": sum(bool(r["cid"]) for r in rows), "revisar": sum(not bool(r["cid"]) for r in rows), "zips": zip_rows}, ensure_ascii=False))


if __name__ == "__main__":
    main()
