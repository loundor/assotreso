import { ApiError, optionalString } from '../errors.js';

export interface InvoiceAllocationInput {
  projectId: string | null;
  categoryId: string | null;
  amount: string;
  amountCents: number;
}

function amountCents(value: unknown, label: string, allowNegative: boolean): number {
  const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().replace(',', '.') : '';
  const pattern = allowNegative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) {
    throw new ApiError(400, `Le champ « ${label} » doit être un montant avec au plus deux décimales.`, 'VALIDATION');
  }
  const parsed = Number(normalized);
  const cents = Math.round(parsed * 100);
  if (!Number.isSafeInteger(cents)) throw new ApiError(400, `Le champ « ${label} » est trop élevé.`, 'VALIDATION');
  return cents;
}

export function absoluteMoneyCents(value: unknown, label: string): number {
  return Math.abs(amountCents(value, label, true));
}

export function parseInvoiceAllocations(value: unknown): InvoiceAllocationInput[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'Le champ « allocations » doit être un tableau.', 'VALIDATION');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ApiError(400, `L’allocation n°${index + 1} doit être un objet.`, 'VALIDATION');
    }
    const record = entry as Record<string, unknown>;
    const projectId = optionalString(record.projectId);
    const categoryId = optionalString(record.categoryId);
    if (!projectId && !categoryId) {
      throw new ApiError(400, `L’allocation n°${index + 1} doit cibler un projet ou une catégorie.`, 'VALIDATION');
    }
    const cents = amountCents(record.amount, `montant de l’allocation n°${index + 1}`, false);
    if (cents <= 0) throw new ApiError(400, 'Le montant d’une allocation doit être strictement positif.', 'VALIDATION');
    return { projectId, categoryId, amount: (cents / 100).toFixed(2), amountCents: cents };
  });
}
