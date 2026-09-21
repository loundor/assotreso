import type { ExtractedAnalysis } from './extraction.js';
import { analyzeInvoiceWithCodex, executeCodexTextPrompt } from './codex.js';
import { analyzeDocumentWithAgy, executeAgyTextPrompt, type AgyDocumentAnalysisOptions } from './agy.js';
import { getPromptContent } from './prompts.js';

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
  'supplier' | 'recipient' | 'invoiceNumber' | 'invoiceDate' | 'totalHt' | 'vatAmount' | 'totalTtc' | 'direction'>;

const FIELD_NAMES = ['supplier', 'recipient', 'invoiceNumber', 'invoiceDate', 'totalHt', 'vatAmount', 'totalTtc', 'direction'] as const;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/\s/g, '').replace(',', '.').replace(/[€$£]/g, '');
    const num = Number.parseFloat(cleaned);
    if (!Number.isNaN(num) && Number.isFinite(num) && num >= 0 && num <= 1_000_000_000) {
      return Math.round(num * 100) / 100;
    }
  }
  return null;
}

function normalizeDirection(value: unknown): 'RECU' | 'EMIS' | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'EMIS' || upper === 'RECETTE' || upper === 'GAIN' || upper === 'VENTE' || upper === 'INCOME') {
    return 'EMIS';
  }
  if (upper === 'RECU' || upper === 'DEPENSE' || upper === 'ACHAT' || upper === 'CHARGE' || upper === 'EXPENSE') {
    return 'RECU';
  }
  return null;
}

function normalizeCandidateKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const norm: Record<string, unknown> = { ...raw };
  const lowerEntries = Object.entries(raw).reduce<Record<string, unknown>>((acc, [k, v]) => {
    acc[k.toLowerCase().replace(/[-_]/g, '')] = v;
    return acc;
  }, {});

  norm.supplier ??= lowerEntries.fournisseur ?? lowerEntries.prestataire ?? lowerEntries.emetteur ?? lowerEntries.commercant;
  norm.recipient ??= lowerEntries.destinataire ?? lowerEntries.client ?? lowerEntries.beneficiaire;
  norm.invoiceNumber ??= lowerEntries.invoicenumber ?? lowerEntries.numero ?? lowerEntries.numerofacture ?? lowerEntries.reference ?? lowerEntries.ref;
  norm.invoiceDate ??= lowerEntries.invoicedate ?? lowerEntries.date ?? lowerEntries.datefacture;
  norm.totalHt ??= lowerEntries.totalht ?? lowerEntries.ht ?? lowerEntries.montantht;
  norm.vatAmount ??= lowerEntries.vatamount ?? lowerEntries.tva ?? lowerEntries.montanttva ?? lowerEntries.taxe;
  norm.totalTtc ??= lowerEntries.totalttc ?? lowerEntries.ttc ?? lowerEntries.montantttc ?? lowerEntries.total;
  norm.direction ??= lowerEntries.direction ?? lowerEntries.sens ?? lowerEntries.type;

  return norm;
}

export function mergeAiAnalysis(local: ExtractedAnalysis, candidate: unknown): ExtractedAnalysis {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return local;
  const raw = candidate as Record<string, unknown>;
  const values = normalizeCandidateKeys(raw);
  const merged = { ...local };

  if (validDate(values.invoiceDate)) {
    merged.invoiceDate = values.invoiceDate;
  }
  const ht = parseAmount(values.totalHt);
  if (ht !== null) merged.totalHt = ht;

  const tva = parseAmount(values.vatAmount);
  if (tva !== null) merged.vatAmount = tva;

  const ttc = parseAmount(values.totalTtc);
  if (ttc !== null) merged.totalTtc = ttc;

  if (validString(values.supplier)) {
    merged.supplier = values.supplier.trim();
  }
  if (validString(values.recipient)) {
    merged.recipient = values.recipient.trim();
  }
  if (validString(values.invoiceNumber)) {
    merged.invoiceNumber = values.invoiceNumber.trim();
  }
  const dir = normalizeDirection(values.direction);
  if (dir) {
    merged.direction = dir;
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

const INVOICE_PROMPT = 'Tu es un expert comptable. Analyse le justificatif fourni (ticket de caisse, facture ou reçu). '
  + 'Réponds STRICTEMENT sous forme d\'un objet JSON typé avec les champs suivants : '
  + 'supplier (string ou null), recipient (string ou null), invoiceNumber (string ou null), '
  + 'invoiceDate (string YYYY-MM-DD ou null), totalHt (number en euros ou null), '
  + 'vatAmount (number en euros ou null), totalTtc (number en euros ou null), '
  + 'direction ("RECU" pour une dépense ou "EMIS" pour une recette). Utilise null si inconnu.';

async function analyzeWithAnthropic(
  ocrText: string,
  settings: AiConnectionSettings,
  fetchImplementation: typeof fetch,
  systemPrompt = INVOICE_PROMPT
): Promise<unknown> {
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
      system: systemPrompt,
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

  const invoicePrompt = await getPromptContent('analyse_justificatif.md', INVOICE_PROMPT);

  if (settings.provider === 'anthropic') return analyzeWithAnthropic(ocrText, settings, fetchImplementation, invoicePrompt);
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
        { role: 'system', content: invoicePrompt },
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

const DEFAULT_REPORT_INSTRUCTIONS = `# Directives et Structure du Rapport Financier Officiel de Trésorerie
Tu es commissaire aux comptes et expert-comptable spécialisé dans le secteur associatif (loi 1901 et Alsace-Moselle).
Rédige un rapport financier et d'audit comptable rigoureux, complet et structuré, destiné à figurer dans le dossier officiel de l'association pour le Bureau, le Conseil d'Administration et l'Assemblée Générale.
Le rapport doit impérativement s'articuler autour des 5 sections suivantes :
1. Synthèse exécutive & Constat de situation générale
2. Analyse détaillée des flux et structure des charges & produits
3. Constat et commentaires analytiques sur les graphiques financiers
4. Audit de conformité, pièces justificatives et rapprochement bancaire
5. Recommandations stratégiques et plan d'action pour le Bureau et l'Assemblée Générale

Rédige en français soigné, professionnel et percutant. Structure le rapport avec des sections numérotées claires. N'inclus aucune balise de code Markdown (\`\`\`) ni de structure JSON dans ta réponse.`;

export async function generateFinancialReportWithAi(
  reportData: Record<string, unknown>,
  settings: AiConnectionSettings,
  fetchImplementation: typeof fetch = fetch
): Promise<string> {
  const asso = (reportData.association as any) || {};
  const period = (reportData.period as any) || {};
  const totals = (reportData.totals as any) || {};
  const rec = (reportData.reconciliation as any) || {};
  const evolution = (reportData.evolution as any[]) || [];
  const categories = (reportData.byCategory as any[]) || [];
  const projects = (reportData.byProject as any[]) || [];
  const topIncomes = (reportData.topIncomes as any[]) || [];
  const topExpenses = (reportData.topExpenses as any[]) || [];
  const comparison = (reportData.comparison as any) || {};

  const template = await getPromptContent('rapport_financier.md', DEFAULT_REPORT_INSTRUCTIONS);
  const prompt = `${template}

---

# DONNÉES FINANCIÈRES CONSOLIDÉES DE L'ASSOCIATION "${asso.name || 'Association'}" (Du ${period.from || 'début'} au ${period.to || 'fin'})

1. DONNÉES DE L'ASSOCIATION :
- Nom : ${asso.name || 'Association'}${asso.acronym ? ` (${asso.acronym})` : ''}
- SIRET : ${asso.siret || 'Non renseigné'} | RNA : ${asso.rna || 'Non renseigné'}
- Adresse : ${asso.address || ''} ${asso.postalCode || ''} ${asso.city || ''}

2. TOTAUX CONSOLIDÉS :
- Total des Recettes : ${(totals.income || 0).toFixed(2)} € (${totals.countIncome || 0} opérations)
- Total des Dépenses : ${(totals.expense || 0).toFixed(2)} € (${totals.countExpense || 0} opérations)
- Résultat Net de la période : ${(totals.net || 0).toFixed(2)} € (${(totals.net || 0) >= 0 ? 'EXCÉDENTAIRE' : 'DÉFICITAIRE'})
- Nombre total d'écritures bancaires : ${totals.count || 0}

3. ÉVOLUTION MENSUELLE DES FLUX (GRAPHIQUE DES FLUX) :
${evolution.length > 0 ? evolution.map(e => `  * Mois ${e.period_month} : Recettes = ${Number(e.income || 0).toFixed(2)} €, Dépenses = ${Number(e.expense || 0).toFixed(2)} €, Solde Net = ${Number(e.net || 0).toFixed(2)} € (${e.count || 0} opérations)`).join('\n') : '  Aucune écriture sur la période.'}

4. RÉPARTITION DES CHARGES ET PRODUITS PAR CATÉGORIE (GRAPHIQUE CATÉGORIES) :
${categories.length > 0 ? categories.map(c => `  * Catégorie "${c.name}" [${c.kind || 'DEPENSE'}] : Recettes = ${Number(c.income || 0).toFixed(2)} €, Dépenses = ${Number(c.expense || 0).toFixed(2)} €, Net = ${Number(c.net || 0).toFixed(2)} €`).join('\n') : '  Aucune catégorie enregistrée.'}

5. SUIVI BUDGÉTAIRE DES PROJETS (GRAPHIQUE DES PROJETS) :
${projects.length > 0 ? projects.map(p => `  * Projet "${p.name}" (Statut: ${p.status || 'EN_COURS'}) : Budget Voté = ${Number(p.budget || 0).toFixed(2)} €, Dépenses Consommées = ${Number(p.expense || 0).toFixed(2)} €, Solde Disponible = ${(Number(p.budget || 0) - Number(p.expense || 0)).toFixed(2)} €`).join('\n') : '  Aucun projet spécifique sur cette période.'}

6. CONTRÔLE INTERNE ET RAPPROCHEMENT BANCAIRE :
- Taux de justification des écritures : ${(rec.rate || 0).toFixed(1)} %
- Total des opérations auditées : ${rec.totalCount || 0}
- Écritures rapprochées à 100% avec facture : ${rec.fullyReconciled || 0}
- Écritures avec rapprochement partiel : ${rec.partiallyReconciled || 0}
- Écritures non justifiées en attente de pièce : ${rec.unreconciled || 0}
- Montant total justifié : ${Number(rec.reconciledAmount || 0).toFixed(2)} €

7. PRINCIPAUX ENCAISSEMENTS (TOP RECETTES) :
${topIncomes.length > 0 ? topIncomes.map(t => `  * ${t.operation_date} : +${Number(t.amount || 0).toFixed(2)} € - ${t.description || 'Recette'} (${t.category_name || 'Sans catégorie'})`).join('\n') : '  Néant.'}

8. PRINCIPAUX DÉCAISSEMENTS (TOP DÉPENSES) :
${topExpenses.length > 0 ? topExpenses.map(t => `  * ${t.operation_date} : -${Number(t.amount || 0).toFixed(2)} € - ${t.description || 'Dépense'} (${t.category_name || 'Sans catégorie'})`).join('\n') : '  Néant.'}

${comparison && comparison.previousTotals ? `9. COMPARAISON AVEC LA PÉRIODE PRÉCÉDENTE :
- Variation Recettes : ${comparison.variations?.income?.diff > 0 ? '+' : ''}${Number(comparison.variations?.income?.diff || 0).toFixed(2)} € (${comparison.variations?.income?.percent ? comparison.variations.income.percent + '%' : 'N/A'})
- Variation Dépenses : ${comparison.variations?.expense?.diff > 0 ? '+' : ''}${Number(comparison.variations?.expense?.diff || 0).toFixed(2)} € (${comparison.variations?.expense?.percent ? comparison.variations.expense.percent + '%' : 'N/A'})
- Évolution du résultat net : ${comparison.variations?.net?.diff > 0 ? '+' : ''}${Number(comparison.variations?.net?.diff || 0).toFixed(2)} €` : ''}
`;

  const system = 'Tu es un commissaire aux comptes et expert-comptable spécialisé dans le secteur associatif (loi 1901 et Alsace-Moselle). Rédige des analyses financières formelles, claires, objectives et complètes pour les dossiers administratifs.';

  // 1. CLI mode (Gemini CLI / agy)
  if (settings.authMode === 'cli') {
    return executeAgyTextPrompt(prompt, settings.model);
  }

  // 2. OpenAI OAuth via Codex
  if (settings.provider === 'openai' && settings.authMode === 'oauth') {
    return executeCodexTextPrompt(prompt, settings.model);
  }

  // 3. Anthropic Claude
  if (settings.provider === 'anthropic') {
    const baseUrl = settings.baseUrl.trim().replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    };
    if (!settings.secret) throw new Error("La clé Anthropic n'est pas configurée.");
    if (settings.authMode === 'oauth') headers.authorization = `Bearer ${settings.secret}`;
    else headers['x-api-key'] = settings.secret;

    const res = await fetchImplementation(baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 3500,
        temperature: 0.3,
        system,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) throw new Error(`Le service IA Anthropic a répondu avec le statut ${res.status}`);
    const data = await res.json() as any;
    const text = data.content?.find((c: any) => c.type === 'text')?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
    throw new Error('Réponse vide du service Anthropic.');
  }

  // 4. OpenAI-compatible API (OpenRouter, OpenAI avec clé API, Mistral, Gemini API)
  if (!settings.secret) {
    throw new Error("La clé d'authentification du service IA n'est pas configurée.");
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${settings.secret}`,
    'content-type': 'application/json'
  };
  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://tresorerie-association.local';
    headers['X-Title'] = 'Trésorerie Association';
  }

  const res = await fetchImplementation(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) throw new Error(`Le service IA (${settings.provider}) a répondu avec le statut ${res.status}`);
  const payload = await res.json() as any;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  throw new Error('La réponse du modèle IA est vide.');
}
