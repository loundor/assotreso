import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

export interface PromptDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  content: string;
}

const KNOWN_PROMPTS = [
  {
    id: 'analyse_justificatif',
    name: 'analyse_justificatif.md',
    title: 'Analyse & extraction des justificatifs (Factures, Tickets, Reçus)',
    description: 'Instructions et typage JSON transmis à l’IA lors du scan ou de l’importation de factures et tickets pour préremplir les écritures comptables.'
  },
  {
    id: 'rapport_financier',
    name: 'rapport_financier.md',
    title: 'Structure & directives du rapport financier officiel (PDF)',
    description: 'Directives de rédaction, structure des sections et ton d’audit transmis à l’IA pour la génération du document PDF officiel.'
  }
] as const;

export async function resolvePromptPath(filename: string): Promise<string> {
  const candidates = [
    join(config.promptsDir, filename),
    resolve(process.cwd(), 'prompts', filename),
    resolve(process.cwd(), 'backend/prompts', filename),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../prompts', filename)
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // Continue search
    }
  }

  // Fallback to primary candidate
  return candidates[0]!;
}

export async function getPromptContent(filename: string, fallback = ''): Promise<string> {
  try {
    const path = await resolvePromptPath(filename);
    const content = await readFile(path, 'utf-8');
    return content;
  } catch {
    return fallback;
  }
}

export async function listPrompts(): Promise<PromptDefinition[]> {
  const results: PromptDefinition[] = [];
  for (const item of KNOWN_PROMPTS) {
    const content = await getPromptContent(item.name, '');
    results.push({
      ...item,
      content
    });
  }
  return results;
}

export async function updatePromptContent(id: string, newContent: string): Promise<PromptDefinition> {
  const meta = KNOWN_PROMPTS.find((p) => p.id === id || p.name === id);
  if (!meta) {
    throw new Error(`Contexte IA introuvable : ${id}`);
  }

  const primaryPath = await resolvePromptPath(meta.name);
  
  // Save to the resolved primary path
  try {
    await mkdir(dirname(primaryPath), { recursive: true });
    await writeFile(primaryPath, newContent, 'utf-8');
  } catch (err) {
    throw new Error(`Impossible d'enregistrer le fichier prompt ${meta.name} : ${(err as Error).message}`);
  }

  // Also write to alternative local candidates if they exist on the filesystem
  const extraCandidates = [
    join(config.promptsDir, meta.name),
    resolve(process.cwd(), 'prompts', meta.name),
    resolve(process.cwd(), 'backend/prompts', meta.name)
  ];

  for (const extra of extraCandidates) {
    if (extra !== primaryPath) {
      try {
        await mkdir(dirname(extra), { recursive: true });
        await writeFile(extra, newContent, 'utf-8');
      } catch {
        // Ignorer les erreurs d'écriture sur les chemins secondaires
      }
    }
  }

  return {
    ...meta,
    content: newContent
  };
}
