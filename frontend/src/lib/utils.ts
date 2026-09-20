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
