import { Readable } from 'node:stream';
import * as ExcelJS from 'exceljs';

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

export const SUPPORTED_EXTENSIONS = ['.xlsx', '.csv'];

export function isSpreadsheetFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cellToString(cell: ExcelJS.Cell): string {
  if (cell === null || cell === undefined) return '';
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>;
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[])
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    }
    if ('result' in obj) {
      // formula cell — use the cached result
      const result = obj.result;
      if (result === null || result === undefined) return '';
      if (result instanceof Date) return result.toISOString();
      if (
        typeof result === 'string' ||
        typeof result === 'number' ||
        typeof result === 'boolean'
      ) {
        return String(result).trim();
      }
      return '';
    }
    if ('text' in obj && typeof obj.text === 'string') return obj.text.trim();
    if ('error' in obj) return '';
  }
  // Non-plain scalar (symbol etc.) — give up cleanly
  return '';
}

async function loadWorkbook(
  buffer: Buffer,
  filename: string,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith('.csv')) {
    const stream = Readable.from(buffer);
    await workbook.csv.read(stream as never);
    return workbook;
  }
  await workbook.xlsx.load(buffer as never);
  return workbook;
}

/**
 * Reads the first worksheet of an xlsx/csv buffer into plain string rows.
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<ParsedSheet> {
  const workbook = await loadWorkbook(buffer, filename);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('File contains no worksheets');
  }

  const matrix: string[][] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    // eachRow gives sparse rows; read 1..columnCount for positional stability
    const colCount = row.cellCount;
    for (let col = 1; col <= colCount; col++) {
      values.push(cellToString(row.getCell(col)));
    }
    // pad/truncate to header length later; keep raw here
    matrix.push(values);
  });

  const firstNonEmpty = matrix.findIndex((r) => r.some((v) => v !== ''));
  if (firstNonEmpty === -1) {
    throw new Error('File contains no data rows');
  }

  const headers = matrix[firstNonEmpty].map((h, i) =>
    h === '' ? `Column ${i + 1}` : h,
  );
  const colTotal = headers.length;
  const rows = matrix
    .slice(firstNonEmpty + 1)
    .map((r) => {
      const out = r.slice(0, colTotal);
      while (out.length < colTotal) out.push('');
      return out;
    })
    .filter((r) => r.some((v) => v !== ''));

  return { headers, rows };
}

/** Reads only headers + the first N data rows (for the mapping step UI). */
export async function parseSpreadsheetPreview(
  buffer: Buffer,
  filename: string,
  sampleCount = 5,
): Promise<{ headers: string[]; sampleRows: string[][]; totalRows: number }> {
  const { headers, rows } = await parseSpreadsheet(buffer, filename);
  return {
    headers,
    sampleRows: rows.slice(0, sampleCount),
    totalRows: rows.length,
  };
}

function sheetToRows(sheet: ExcelJS.Worksheet): string[][] {
  const matrix: string[][] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    const colCount = row.cellCount;
    for (let col = 1; col <= colCount; col++) {
      values.push(cellToString(row.getCell(col)));
    }
    matrix.push(values);
  });
  return matrix.filter((r) => r.some((v) => v !== ''));
}

/**
 * Reads every worksheet of an xlsx into { name, rows } (first non-empty row
 * per sheet is treated as its header). Used to find aux sheets such as the
 * Outreach_Playbook.
 */
export async function parseAllSheets(
  buffer: Buffer,
  filename: string,
): Promise<{ name: string; rows: string[][] }[]> {
  const workbook = await loadWorkbook(buffer, filename);
  return workbook.worksheets
    .filter((s) => !!s)
    .map((sheet) => ({ name: sheet.name, rows: sheetToRows(sheet) }))
    .filter((s) => s.rows.length > 0);
}
