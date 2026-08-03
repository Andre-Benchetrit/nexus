import json
import sys
from pathlib import Path


def repair(text):
    if not isinstance(text, str):
        return text
    try:
        return text.encode("latin1").decode("utf8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


current_path, previous_path = map(Path, sys.argv[1:3])
current = json.loads(current_path.read_text(encoding="utf8"))
previous = json.loads(previous_path.read_text(encoding="utf8"))
by_file = {r["Arquivo"]: r for r in previous}

restored = 0
for row in current["resultados"]:
    old = by_file.get(row["arquivo"])
    if old and old.get("CID") and not row.get("cid"):
        row["cid"] = old["CID"]
        row["status"] = "CID encontrado - preservado da leitura anterior"
        row["trecho"] = repair(old.get("Trecho de validaÃ§Ã£o", ""))
        restored += 1

current_path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"total": len(current["resultados"]), "com_cid": sum(bool(r["cid"]) for r in current["resultados"]), "restaurados": restored}))
