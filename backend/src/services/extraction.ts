export interface ExtractedAnalysis {
  supplier: string | null;
  recipient: string | null;
  invoiceDate: string | null;
  totalTtc: number | null;
  totalHt: number | null;
  vatAmount: number | null;
  invoiceNumber: string | null;
  siret: string | null;
  paymentMethod: string | null;
  email: string | null;
  direction?: string | null;
  confidence: number;
  warnings: string[];
}

function normalizedAmount(raw: string): number | null {
  const compact = raw.replace(/[€\s\u00a0]/g, '').replace(',', '.');
  const value = Number.parseFloat(compact);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function firstAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const raw = match?.[1];
    if (raw) return normalizedAmount(raw);
  }
  return null;
}

function amountsOnLine(line: string): number[] {
  return [...line.matchAll(/-?\d[\d\s]*(?:[.,]\d{2})\s*€/g)]
    .map((match) => normalizedAmount(match[0]))
    .filter((amount): amount is number => amount !== null);
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const fullYear = year.length === 2 ? `20${year}` : year;
  const date = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().slice(0, 10);
  return iso === `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` ? iso : null;
}

function extractDate(text: string): string | null {
  const frenchMonths: Record<string, string> = {
    janvier: '1', fevrier: '2', février: '2', mars: '3', avril: '4', mai: '5', juin: '6',
    juillet: '7', aout: '8', août: '8', septembre: '9', octobre: '10', novembre: '11', decembre: '12', décembre: '12'
  };
  const written = /\b(\d{1,2})\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(\d{4})\b/i.exec(text);
  if (written?.[1] && written[2] && written[3]) {
    const month = frenchMonths[written[2].toLowerCase()];
    if (month) return toIsoDate(written[1], month, written[3]);
  }

  const numeric = /(?:date(?:\s+de\s+facture)?\s*[:\-]?\s*)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i.exec(text);
  return numeric?.[1] && numeric[2] && numeric[3] ? toIsoDate(numeric[1], numeric[2], numeric[3]) : null;
}

function extractParties(lines: string[]): { supplier: string | null; recipient: string | null } {
  const legalEntity = lines
    .map((line) => /^(.*?\b(?:SASU?|SARL|EURL|S\.A\.|SA|SNC|ASSOCIATION))\b/i.exec(line)?.[1]?.trim() ?? null)
    .find((line): line is string => Boolean(line && line.length <= 100));
  const ignored = /^(facture|ticket|reçu|recu|date|original|duplicata|total|tva|dont|somme|montant|détails?|services?|offre|identifiant|r[eé]f[eé]rence|email|adresse|page|besoin|scannez|assistance|free service|\d+d-doc)\b/i;
  const partyCandidate = lines.find((line) =>
    line.length >= 3 && line.length <= 100 &&
    /[A-Za-zÀ-ÿ]{3}/.test(line) && !ignored.test(line) &&
    !/\d{3,}|@|\b(?:rue|avenue|boulevard|cedex)\b/i.test(line)
  ) ?? null;

  if (legalEntity) {
    const recipient = partyCandidate && partyCandidate.toLocaleLowerCase('fr') !== legalEntity.toLocaleLowerCase('fr')
      ? partyCandidate
      : null;
    return { supplier: legalEntity, recipient };
  }
  return { supplier: partyCandidate, recipient: null };
}

export function extractInvoiceFields(rawText: string): ExtractedAnalysis {
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const totalRowAmounts = lines
    .filter((line) => /^total(?=\s|\d)/i.test(line))
    .map(amountsOnLine)
    .find((amounts) => amounts.length >= 2) ?? [];

  const ttc = firstAmount(text, [
    /(?:total\s*(?:ttc|t\.t\.c)|net\s*[àa]\s*payer|montant\s*(?:ttc|total))\s*[:€]?\s*([0-9][0-9\s.,]*)/i,
    /(?:somme\s*[àa]\s*payer|à payer|a payer)\D{0,40}([0-9][0-9\s.,]*)\s*€/i
  ]) ?? totalRowAmounts.at(-1) ?? null;
  const ht = firstAmount(text, [/(?:total\s*ht|montant\s*ht|hors\s*taxe[s]?)\s*[:€]?\s*([0-9][0-9\s.,]*)/i])
    ?? totalRowAmounts[0] ?? null;

  const vatMatches = [...text.matchAll(/TVA\s+\d{1,2}(?:[.,]\d+)?\s*%\s*:\s*([0-9][0-9\s.,]*)\s*€/gi)];
  let vat = vatMatches.length
    ? Math.round(vatMatches.reduce((sum, match) => sum + (normalizedAmount(match[1] ?? '') ?? 0), 0) * 100) / 100
    : firstAmount(text, [/(?:total\s*)?(?:tva|taxe)\s*(?:\d{1,2}(?:[.,]\d+)?\s*%)?\s*[:€]?\s*([0-9][0-9\s.,]*)/i]);
  if (vat === null && ttc !== null && ht !== null && ttc >= ht) {
    vat = Math.round((ttc - ht) * 100) / 100;
  }

  const invoiceMatch = /\bn[°oº.]?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_./-]{2,})\s+(?:du|date)/i.exec(text)
    ?? /(?:facture|invoice)\s*(?:n[°oº.]?|num(?:é|e)ro)\s*[:#-]?\s*([A-Z0-9][A-Z0-9_./-]{2,})/i.exec(text);
  const siretMatch = /SIRET\s*[:\-]?\s*((?:\d[ .]?){14})/i.exec(text);
  const emailMatch = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.exec(text);
  const paymentMatch = /(?:paiement|mode de r[eè]glement|r[eè]glement)\s*[:\-]?\s*(carte(?: bancaire)?|cb|esp[eè]ces?|ch[eè]que|virement|pr[eé]l[eè]vement)/i.exec(text);
  const { supplier, recipient } = extractParties(lines);
  const invoiceDate = extractDate(text);

  const found = [supplier, recipient, invoiceDate, ttc, ht, vat, invoiceMatch?.[1], siretMatch?.[1], emailMatch?.[0]]
    .filter((value) => value !== null && value !== undefined).length;
  const confidence = Math.min(0.98, Math.round((0.18 + found * 0.085 + (ttc !== null ? 0.14 : 0)) * 100) / 100);
  const warnings: string[] = [];
  if (ttc === null) warnings.push('Montant TTC non détecté.');
  if (invoiceDate === null) warnings.push('Date non détectée.');
  if (supplier === null) warnings.push('Fournisseur non détecté.');
  if (invoiceMatch?.[1] === undefined) warnings.push('Numéro de facture non détecté.');
  if (ttc !== null && ht !== null && vat !== null && Math.abs(ttc - ht - vat) > 0.05) {
    warnings.push('Les montants HT, TVA et TTC semblent incohérents.');
  }

  return {
    supplier,
    recipient,
    invoiceDate,
    totalTtc: ttc,
    totalHt: ht,
    vatAmount: vat,
    invoiceNumber: invoiceMatch?.[1] ?? null,
    siret: siretMatch?.[1]?.replace(/\D/g, '') ?? null,
    paymentMethod: paymentMatch?.[1]?.toUpperCase() ?? null,
    email: emailMatch?.[0] ?? null,
    confidence,
    warnings
  };
}
