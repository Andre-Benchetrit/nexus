import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sheet = wb.worksheets.getItem("CIDs encontrados");
const values = sheet.getRange("A1:H200").values;
const headers = values[0];
const rows = values.slice(1).filter((r) => r[4]).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
await fs.writeFile(process.argv[3], JSON.stringify(rows, null, 2), "utf8");
console.log(JSON.stringify({ rows: rows.length }));
