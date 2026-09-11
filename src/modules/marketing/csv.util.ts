/** Shared CSV helpers for marketing exports. */

type CsvValue = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return escape(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return escape(String(value));
  }
  if (value instanceof Date) return escape(value.toISOString());
  return escape(String(value as { toString(): string }));
}

function escape(str: string): string {
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function sendCsv(
  res: {
    setHeader: (name: string, value: string) => void;
    send: (body: string) => void;
  },
  filename: string,
  rows: (string | number | null | undefined)[][],
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(toCsv(rows));
}
