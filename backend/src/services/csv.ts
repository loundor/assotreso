import { ApiError } from '../errors.js';

export interface CsvTransaction {
  operationDate: string;
  amount: number;
  description: string;
  bankLabel: string | null;
  bankReference: string | null;
}

export function parseCsvRows(content: string, separator?: string): string[][] {
  const cleaned = content.replace(/^\uFEFF/, '');
  const delimiter = separator ?? (cleaned.split('\n', 1)[0]?.includes(';') ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (character === '"') {
      if (quoted && cleaned[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && cleaned[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new ApiError(400, 'Le fichier CSV contient un champ entre guillemets non terminé.', 'CSV_INVALIDE');
  return rows;
}

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function columnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(normalizedHeader(header)));
}

function csvDate(value: string): string {
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(value.trim());
  if (match?.[1] && match[2] && match[3]) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  throw new ApiError(400, `Date CSV invalide : « ${value} ».`, 'CSV_INVALIDE');
}

function csvNumber(value: string): number {
  const normalized = value.replace(/[€\s\u00a0]/g, '').replace(',', '.');
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number)) throw new ApiError(400, `Montant CSV invalide : « ${value} ».`, 'CSV_INVALIDE');
  return Math.round(number * 100) / 100;
}

export function parseBankCsv(content: string): CsvTransaction[] {
  const rows = parseCsvRows(content);
  const headers = rows.shift();
  if (!headers) throw new ApiError(400, 'Le fichier CSV est vide.', 'CSV_INVALIDE');
  const dateIndex = columnIndex(headers, ['date', 'dateoperation', 'operationdate']);
  const labelIndex = columnIndex(headers, ['libelle', 'libellebancaire', 'description', 'label']);
  const amountIndex = columnIndex(headers, ['montant', 'amount']);
  const debitIndex = columnIndex(headers, ['debit']);
  const creditIndex = columnIndex(headers, ['credit']);
  const referenceIndex = columnIndex(headers, ['reference', 'referencebancaire', 'ref']);
  if (dateIndex < 0 || labelIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new ApiError(400, 'Colonnes requises : date, libellé, et montant (ou débit/crédit).', 'CSV_COLONNES');
  }

  return rows.map((row, index) => {
    const date = row[dateIndex];
    const label = row[labelIndex];
    if (!date || !label) throw new ApiError(400, `Ligne CSV ${index + 2} incomplète.`, 'CSV_INVALIDE');
    let amount: number;
    const directAmount = amountIndex >= 0 ? row[amountIndex] : undefined;
    if (directAmount) amount = csvNumber(directAmount);
    else {
      const debit = debitIndex >= 0 && row[debitIndex] ? csvNumber(row[debitIndex] ?? '') : 0;
      const credit = creditIndex >= 0 && row[creditIndex] ? csvNumber(row[creditIndex] ?? '') : 0;
      amount = credit - Math.abs(debit);
    }
    if (amount === 0) throw new ApiError(400, `Montant nul à la ligne CSV ${index + 2}.`, 'CSV_INVALIDE');
    return {
      operationDate: csvDate(date),
      amount,
      description: label,
      bankLabel: label,
      bankReference: referenceIndex >= 0 ? row[referenceIndex] || null : null
    };
  });
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
