// RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes, CRLF/LF/CR, BOM, auto-detected delimiter.

export class CsvError extends Error {}

export function detectDelimiter(text) {
  const head = text.slice(0, 4000);
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t']) {
    // Count delimiters outside quotes on the first line only.
    let inQuotes = false;
    let n = 0;
    for (const ch of head) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
      else if (!inQuotes && ch === d) n++;
    }
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

export function parseCsv(input, { delimiter, maxRows = Infinity } = {}) {
  let text = String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoted = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; quoted = false; };
  const endRow = () => {
    endField();
    // Skip fully blank lines.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new CsvError(`The file has more than ${maxRows} rows`);
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !quoted) { inQuotes = true; quoted = true; i++; continue; }
    if (ch === sep) { endField(); i++; continue; }
    if (ch === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvError('The file has an opening quote that is never closed');
  if (field !== '' || row.length) endRow();
  return { rows, delimiter: sep };
}
