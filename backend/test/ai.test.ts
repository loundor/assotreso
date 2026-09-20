import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInvoiceWithAi, mergeAiAnalysis } from '../src/services/ai.js';
import type { ExtractedAnalysis } from '../src/services/extraction.js';

const local: ExtractedAnalysis = {
  supplier: 'Local', recipient: null, invoiceNumber: null, invoiceDate: '2026-01-02',
  totalHt: 10, vatAmount: 2, totalTtc: 12, siret: null, paymentMethod: null,
  email: null, confidence: 0.6, warnings: ['Vérification nécessaire.']
};

test('fusionne uniquement les valeurs IA valides', () => {
  const merged = mergeAiAnalysis(local, {
    supplier: '  Fournisseur IA  ', recipient: '', invoiceNumber: 'F-42',
    invoiceDate: '2026-02-30', totalHt: 100.126, vatAmount: -2, totalTtc: 120
  });
  assert.equal(merged.supplier, 'Fournisseur IA');
  assert.equal(merged.recipient, null);
  assert.equal(merged.invoiceNumber, 'F-42');
  assert.equal(merged.invoiceDate, '2026-01-02');
  assert.equal(merged.totalHt, 100.13);
  assert.equal(merged.vatAmount, 2);
  assert.equal(merged.totalTtc, 120);
  assert.deepEqual(merged.warnings, local.warnings);
});

test('ignore une réponse IA qui n’est pas un objet', () => {
  assert.deepEqual(mergeAiAnalysis(local, 'invalide'), local);
});

test('utilise le protocole OpenAI pour OpenRouter', async () => {
  let requestedUrl = '';
  let requestedHeaders: Headers | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"supplier":"Free"}' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  const result = await analyzeInvoiceWithAi('facture', {
    provider: 'openrouter', authMode: 'api_key', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', secret: 'secret'
  }, fakeFetch) as { supplier: string };

  assert.equal(requestedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requestedHeaders?.get('authorization'), 'Bearer secret');
  assert.equal(requestedHeaders?.get('X-Title'), 'Trésorerie Association');
  assert.equal(result.supplier, 'Free');
});

test('utilise Codex pour la connexion OAuth OpenAI', async () => {
  let receivedText = '';
  let receivedModel = '';
  const result = await analyzeInvoiceWithAi('facture OAuth', {
    provider: 'openai', authMode: 'oauth', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', secret: undefined
  }, fetch, async (text, model) => {
    receivedText = text;
    receivedModel = model;
    return { supplier: 'OpenAI OAuth' };
  }) as { supplier: string };

  assert.equal(receivedText, 'facture OAuth');
  assert.equal(receivedModel, 'gpt-5.6-luna');
  assert.equal(result.supplier, 'OpenAI OAuth');
});

test('utilise le protocole natif et la clé API Anthropic', async () => {
  let requestedUrl = '';
  let requestedHeaders: Headers | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"invoiceNumber":"F-42"}' }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  const result = await analyzeInvoiceWithAi('facture', {
    provider: 'anthropic', authMode: 'api_key', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', secret: 'secret'
  }, fakeFetch) as { invoiceNumber: string };

  assert.equal(requestedUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(requestedHeaders?.get('x-api-key'), 'secret');
  assert.equal(requestedHeaders?.get('anthropic-version'), '2023-06-01');
  assert.equal(requestedHeaders?.get('authorization'), null);
  assert.equal(result.invoiceNumber, 'F-42');
});

test('utilise le mode CLI agy en lui passant le document et les instructions', async () => {
  let receivedOptions: unknown;
  const fakeAgy = async (options: unknown) => {
    receivedOptions = options;
    return { supplier: 'Boulangerie agy', totalTtc: 18.5 };
  };

  const result = await analyzeInvoiceWithAi('texte ocr', {
    provider: 'gemini', authMode: 'cli', baseUrl: '', model: 'gemini-3.8-flash-high', secret: undefined
  }, fetch, undefined, fakeAgy as any, {
    filePath: '/tmp/test.pdf',
    mimeType: 'application/pdf'
  }) as { supplier: string; totalTtc: number };

  assert.deepEqual(receivedOptions, {
    filePath: '/tmp/test.pdf',
    mimeType: 'application/pdf',
    ocrText: 'texte ocr',
    model: 'gemini-3.8-flash-high'
  });
  assert.equal(result.supplier, 'Boulangerie agy');
  assert.equal(result.totalTtc, 18.5);
});

test('utilise le protocole compatible pour Gemini avec clé API', async () => {
  let requestedUrl = '';
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    requestedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"supplier":"Google Store","totalTtc":49.99}' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  const result = await analyzeInvoiceWithAi('facture gemini', {
    provider: 'gemini', authMode: 'api_key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', secret: 'gemini-key'
  }, fakeFetch) as { supplier: string; totalTtc: number };

  assert.equal(requestedUrl, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(requestedHeaders?.get('authorization'), 'Bearer gemini-key');
  assert.equal(requestedBody?.model, 'gemini-2.5-flash');
  assert.equal(result.supplier, 'Google Store');
  assert.equal(result.totalTtc, 49.99);
});
