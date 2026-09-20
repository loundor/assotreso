import type { ExtractedAnalysis } from './extraction.js';
import { analyzeInvoiceWithCodex } from './codex.js';
import { analyzeDocumentWithAgy, type AgyDocumentAnalysisOptions } from './agy.js';

export type AiProvider = 'openrouter' | 'openai' | 'anthropic' | 'mistral' | 'gemini';
export type AiAuthMode = 'api_key' | 'oauth' | 'cli';

export interface AiConnectionSettings {
  provider: AiProvider;
  authMode: AiAuthMode;
  baseUrl: string;
  model: string;
  secret: string | undefined;
}

export interface AiDocumentOptions {
  filePath?: string | undefined;
  mimeType?: string | undefined;
  buffer?: Buffer | undefined;
}

export type AiInvoiceFields = Pick<ExtractedAnalysis,
  'supplier' | 'recipient' | 'invoiceNumber' | 'invoiceDate' | 'totalHt' | 'vatAmount' | 'totalTtc'>;

const FIELD_NAMES = ['supplier', 'recipient', 'invoiceNumber', 'invoiceDate', 'totalHt', 'vatAmount', 'totalTtc'] as const;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500;
}

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
}

export function mergeAiAnalysis(local: ExtractedAnalysis, candidate: unknown): ExtractedAnalysis {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return local;
  const values = candidate as Record<string, unknown>;
  const merged = { ...local };
  for (const field of FIELD_NAMES) {
    const value = values[field];
    if (field === 'invoiceDate') {
      if (validDate(value)) merged.invoiceDate = value;
    } else if (field === 'totalHt' || field === 'vatAmount' || field === 'totalTtc') {
      if (validAmount(value)) merged[field] = Math.round(value * 100) / 100;
    } else if (validString(value)) {
      merged[field] = value.trim();
    }
  }
  return merged;
}

function chatCompletionsUrl(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error("L'URL du service IA n'est pas configurée.");
  if (normalized === 'https://generativelanguage.googleapis.com/v1beta') {
    normalized = 'https://generativelanguage.googleapis.com/v1beta/openai';
  }
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function jsonFromContent(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1];
  return JSON.parse((fenced ?? content).trim());
}

const INVOICE_PROMPT = 'Extrait les données de facture du texte OCR. Réponds uniquement avec un objet JSON ayant exactement les clés supplier, recipient, invoiceNumber, invoiceDate (YYYY-MM-DD), totalHt, vatAmount, totalTtc. Utilise null si une valeur est inconnue et des nombres JSON pour les montants.';

async function analyzeWithAnthropic(ocrText: string, settings: AiConnectionSettings, fetchImplementation: typeof fetch): Promise<unknown> {
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };
  if (!settings.secret) throw new Error("La clé Anthropic n'est pas configurée.");
  if (settings.authMode === 'oauth') headers.authorization = `Bearer ${settings.secret}`;
  else headers['x-api-key'] = settings.secret;

  const response = await fetchImplementation(baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      temperature: 0,
      system: INVOICE_PROMPT,
      messages: [{ role: 'user', content: ocrText }]
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Le service IA a répondu avec le statut ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: unknown }> };
  const content = payload.content?.find((item) => item.type === 'text')?.text;
  if (typeof content !== 'string') throw new Error("La réponse IA ne contient pas d'analyse exploitable.");
  return jsonFromContent(content);
}

export async function analyzeInvoiceWithAi(
  ocrText: string,
  settings: AiConnectionSettings,
  fetchImplementation: typeof fetch = fetch,
  codexImplementation: (text: string, model: string) => Promise<unknown> = analyzeInvoiceWithCodex,
  agyImplementation: (options: AgyDocumentAnalysisOptions) => Promise<unknown> = analyzeDocumentWithAgy,
  documentOptions?: AiDocumentOptions
): Promise<unknown> {
  if (settings.authMode === 'cli') {
    return agyImplementation({
      filePath: documentOptions?.filePath,
      mimeType: documentOptions?.mimeType,
      ocrText,
      model: settings.model
    });
  }

  if (settings.provider === 'anthropic') return analyzeWithAnthropic(ocrText, settings, fetchImplementation);
  if (settings.provider === 'openai' && settings.authMode === 'oauth') {
    return codexImplementation(ocrText, settings.model);
  }
  if (!settings.secret) throw new Error("La clé API du service IA n'est pas configurée.");

  const headers: Record<string, string> = {
    authorization: `Bearer ${settings.secret}`,
    'content-type': 'application/json'
  };
  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://tresorerie-association.local';
    headers['X-Title'] = 'Trésorerie Association';
  }
  const response = await fetchImplementation(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INVOICE_PROMPT },
        { role: 'user', content: ocrText }
      ]
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Le service IA a répondu avec le statut ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error("La réponse IA ne contient pas d'analyse exploitable.");
  return jsonFromContent(content);
}
