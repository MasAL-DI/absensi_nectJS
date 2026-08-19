/** Setara fputcsv() dari PHP: bungkus field dengan koma/kutip/baris-baru dalam tanda kutip ganda. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export class CsvBuilder {
  private lines: string[] = [];

  row(fields: unknown[]) {
    this.lines.push(fields.map(csvField).join(','));
  }

  blank() {
    this.lines.push('');
  }

  toString(): string {
    // BOM UTF-8 di depan, sama seperti fputs($out, "\xEF\xBB\xBF") di versi PHP
    return '\uFEFF' + this.lines.join('\r\n');
  }
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'text/csv; charset=UTF-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Pragma': 'no-cache',
    'Expires': '0',
  };
}
