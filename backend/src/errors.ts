export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'ERREUR_API'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, `Le champ « ${label} » est obligatoire.`, 'VALIDATION');
  }
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function numeric(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw new ApiError(400, `Le champ « ${label} » doit être un nombre.`, 'VALIDATION');
  return parsed;
}

export function optionalNumeric(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return numeric(value, label);
}

export function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Le corps de la requête doit être un objet JSON.', 'VALIDATION');
  }
  return value as Record<string, unknown>;
}
