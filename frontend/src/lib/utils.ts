export const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const number = new Intl.NumberFormat('fr-FR');

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR').format(date);
}

export function displayName(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'name' in value) return String((value as { name: unknown }).name);
  return String(value);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

export interface FiscalYearInfo {
  startStr: string;
  endStr: string;
  startYear: number;
  endYear: number;
  labelYear: string;
  relativeLabel: string;
  isCurrent: boolean;
}

export function getFiscalYearInfo(day = 1, month = 1, offset = 0): FiscalYearInfo {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  let baseStartYear = currentYear;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    baseStartYear = currentYear - 1;
  }

  const startYear = baseStartYear + offset;
  const start = new Date(Date.UTC(startYear, month - 1, day));
  const nextStart = new Date(Date.UTC(startYear + 1, month - 1, day));
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);

  const pad = (n: number) => String(n).padStart(2, '0');
  const startStr = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
  const endStr = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;

  const labelYear = start.getUTCFullYear() === end.getUTCFullYear()
    ? `${start.getUTCFullYear()}`
    : `${start.getUTCFullYear()}-${end.getUTCFullYear()}`;

  const relativeLabel = offset === 0 ? 'N (en cours)' : (offset < 0 ? `N${offset}` : `N+${offset}`);

  return {
    startStr,
    endStr,
    startYear: start.getUTCFullYear(),
    endYear: end.getUTCFullYear(),
    labelYear,
    relativeLabel,
    isCurrent: offset === 0
  };
}

