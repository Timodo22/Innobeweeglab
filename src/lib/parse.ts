import Papa from "papaparse";
import type { ColumnSpec, SourceFormat } from "../../shared/types";
import { inferColumns } from "../../shared/infer";

export interface ParsedFile {
  name: string;
  format: SourceFormat;
  /** Tabular sources */
  columns: ColumnSpec[] | null;
  rows: (string | number | null)[][] | null;
  /** Text sources */
  raw_text: string | null;
  warning?: string;
}

const MAX_ROWS = 5000;

/**
 * Parsing happens in the browser so the researcher can check the column mapping
 * before anything is committed, and so the Worker never has to carry xlsx/docx
 * decoding. Heavy parsers are loaded on demand.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name;
  const extension = name.toLowerCase().split(".").pop() ?? "";

  if (extension === "csv" || extension === "tsv") return parseCsv(file, name);
  if (extension === "xlsx" || extension === "xls") return parseExcel(file, name);
  if (extension === "docx") return parseDocx(file, name);
  if (["txt", "md", "vtt", "srt", "json"].includes(extension)) {
    return { name, format: "text", columns: null, rows: null, raw_text: cleanText(await file.text()) };
  }
  throw new Error(`Unsupported file type ".${extension}". Upload CSV, XLSX, DOCX, TXT or MD, or paste the text directly.`);
}

async function parseCsv(file: File, name: string): Promise<ParsedFile> {
  const result = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
  const table = result.data.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (table.length < 2) throw new Error("The file needs a header row and at least one data row.");
  return fromTable(name, "csv", table[0].map(String), table.slice(1));
}

async function parseExcel(file: File, name: string): Promise<ParsedFile> {
  const { default: readXlsxFile } = await import("read-excel-file");
  const raw = (await readXlsxFile(file)) as (string | number | Date | boolean | null)[][];
  const table = raw
    .map((row) => row.map((cell) =>
      cell instanceof Date ? cell.toISOString().slice(0, 10)
        : typeof cell === "boolean" ? String(cell)
        : cell))
    .filter((row) => row.some((c) => c !== null && String(c).trim() !== ""));
  if (table.length < 2) throw new Error("The sheet needs a header row and at least one data row.");
  return fromTable(name, "xlsx", table[0].map((c) => String(c ?? "")), table.slice(1) as (string | number | null)[][]);
}

async function parseDocx(file: File, name: string): Promise<ParsedFile> {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const raw_text = cleanText(value);
  if (!raw_text.trim()) throw new Error("No text could be extracted from this document.");
  return { name, format: "docx", columns: null, rows: null, raw_text };
}

function fromTable(
  name: string, format: SourceFormat, header: string[], body: (string | number | null)[][],
): ParsedFile {
  const truncated = body.length > MAX_ROWS;
  const rows = (truncated ? body.slice(0, MAX_ROWS) : body)
    .map((row) => header.map((_, i) => normalizeCell(row[i])));
  return {
    name, format, rows, raw_text: null,
    columns: inferColumns(header.map((h, i) => h.trim() || `column_${i + 1}`), rows),
    warning: truncated ? `Only the first ${MAX_ROWS} of ${body.length} rows were kept.` : undefined,
  };
}

function normalizeCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Word and VTT exports carry artefacts that would otherwise become fake segments. */
function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT.*$/m, "")
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*$/gm, "")
    .replace(/ /g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
