import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputPath = process.argv[2];
const outputDir = process.argv[3];
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
const found = data.resultados.filter((r) => r.cid);
const review = data.resultados.filter((r) => !r.cid);
function confidence(r) {
  if (r.metodo === "texto do PDF") return "Alta";
  const compact = (r.trecho || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const visible = r.cid.split(",").every((c) => compact.includes(c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")));
  return visible ? "Média - validar OCR" : "Baixa - revisar imagem";
}

const wb = Workbook.create();
const summary = wb.worksheets.add("Resumo");
const cids = wb.worksheets.add("CIDs encontrados");
const pending = wb.worksheets.add("Revisar");

function title(sheet, text, endCol) {
  sheet.mergeCells(`A1:${endCol}1`);
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endCol}1`).format = {
    fill: "#17365D", font: { bold: true, color: "#FFFFFF", size: 16 },
    verticalAlignment: "center", rowHeight: 30
  };
  sheet.showGridLines = false;
}

title(summary, "Levantamento de CIDs - Atestados 2026", "D");
summary.getRange("A3:B6").values = [
  ["Indicador", "Quantidade"],
  ["Documentos analisados", null],
  ["CIDs encontrados", null],
  ["Documentos para revisão", null],
];
summary.getRange("B4").formulas = [[`=COUNTA('CIDs encontrados'!D2:D${found.length + 1})+COUNTA('Revisar'!C2:C${review.length + 1})`]];
summary.getRange("B5").formulas = [[`=COUNTA('CIDs encontrados'!B2:B${found.length + 1})`]];
summary.getRange("B6").formulas = [[`=COUNTA('Revisar'!C2:C${review.length + 1})`]];
summary.getRange("A3:B3").format = { fill: "#D9EAF7", font: { bold: true, color: "#17365D" }, borders: { preset: "outside", style: "thin", color: "#9FBAD0" } };
summary.getRange("A4:A6").format.font = { bold: true, color: "#334155" };
summary.getRange("B4:B6").format = { font: { bold: true, color: "#17365D", size: 14 }, horizontalAlignment: "center", numberFormat: "0" };
summary.getRange("A8:D10").values = [["Notas", null, null, null],["Os CIDs foram aceitos apenas quando o OCR encontrou um código imediatamente associado ao rótulo CID. A aba Revisar contém documentos sem CID localizado automaticamente; isso pode indicar ausência do código ou imagem pouco legível.", null, null, null],["O arquivo ZIP de abril contém cópias dos mesmos 14 PDFs já presentes na pasta e não foi contado em duplicidade.", null, null, null]];
summary.mergeCells("A8:D8"); summary.mergeCells("A9:D9"); summary.mergeCells("A10:D10");
summary.getRange("A8:D8").format = { fill: "#FFF2CC", font: { bold: true, color: "#7F6000" } };
summary.getRange("A9:D10").format = { wrapText: true, verticalAlignment: "top", fill: "#FFFDF2" };
summary.getRange("A:A").format.columnWidth = 32;
summary.getRange("B:B").format.columnWidth = 18;
summary.getRange("C:D").format.columnWidth = 16;
summary.getRange("9:10").format.rowHeight = 42;

const foundHeaders = ["Pessoa (pelo arquivo)", "CID", "Confiança", "Mês/pasta", "Arquivo", "Método", "Trecho de validação", "Caminho de origem"];
cids.getRange("A1:H1").values = [foundHeaders];
cids.getRange(`A2:H${found.length + 1}`).values = found.map((r) => [r.pessoa, r.cid, confidence(r), r.pasta, r.arquivo, r.metodo, r.trecho, r.caminho]);
cids.getRange("A1:H1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 30 };
cids.getRange(`A2:H${found.length + 1}`).format = { verticalAlignment: "top", wrapText: true };
cids.getRange(`B2:B${found.length + 1}`).format = { font: { bold: true, color: "#006100" }, fill: "#E2F0D9", horizontalAlignment: "center" };
cids.getRange(`C2:C${found.length + 1}`).format = { fill: "#FFF2CC", font: { color: "#7F6000" } };
cids.freezePanes.freezeRows(1);
cids.getRange("A:A").format.columnWidth = 24; cids.getRange("B:B").format.columnWidth = 13;
cids.getRange("C:C").format.columnWidth = 22; cids.getRange("D:D").format.columnWidth = 12; cids.getRange("E:E").format.columnWidth = 38;
cids.getRange("F:F").format.columnWidth = 18; cids.getRange("G:G").format.columnWidth = 55; cids.getRange("H:H").format.columnWidth = 55;

const reviewHeaders = ["Pessoa (pelo arquivo)", "Mês/pasta", "Arquivo", "Motivo", "Método", "Caminho de origem"];
pending.getRange("A1:F1").values = [reviewHeaders];
pending.getRange(`A2:F${review.length + 1}`).values = review.map((r) => [r.pessoa, r.pasta, r.arquivo, r.status, r.metodo, r.caminho]);
pending.getRange("A1:F1").format = { fill: "#7F6000", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 30 };
pending.getRange(`A2:F${review.length + 1}`).format = { verticalAlignment: "top", wrapText: true };
pending.getRange(`D2:D${review.length + 1}`).format = { fill: "#FFF2CC", font: { color: "#7F6000" } };
pending.freezePanes.freezeRows(1);
pending.getRange("A:A").format.columnWidth = 24; pending.getRange("B:B").format.columnWidth = 12;
pending.getRange("C:C").format.columnWidth = 40; pending.getRange("D:D").format.columnWidth = 30;
pending.getRange("E:E").format.columnWidth = 18; pending.getRange("F:F").format.columnWidth = 60;

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, filename] of [["Resumo", "A1:D10", "preview_resumo.png"], ["CIDs encontrados", `A1:H${Math.min(found.length + 1, 20)}`, "preview_cids.png"], ["Revisar", `A1:F${Math.min(review.length + 1, 20)}`, "preview_revisar.png"]]) {
  const preview = await wb.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await preview.arrayBuffer()));
}
console.log((await wb.inspect({ kind: "table", range: "Resumo!A1:D10", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 6 })).ndjson);
console.log((await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula errors" })).ndjson);
const out = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(outputDir, process.argv[4] || "CIDs_Atestados_2026.xlsx");
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, found: found.length, review: review.length }));
