import { spawn } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    supplier: { type: ['string', 'null'] },
    recipient: { type: ['string', 'null'] },
    invoiceNumber: { type: ['string', 'null'] },
    invoiceDate: { type: ['string', 'null'] },
    totalHt: { type: ['number', 'null'] },
    vatAmount: { type: ['number', 'null'] },
    totalTtc: { type: ['number', 'null'] }
  },
  required: ['supplier', 'recipient', 'invoiceNumber', 'invoiceDate', 'totalHt', 'vatAmount', 'totalTtc']
};

export interface AgyDocumentAnalysisOptions {
  filePath?: string | undefined;
  mimeType?: string | undefined;
  ocrText?: string | undefined;
  model?: string | undefined;
}

const CANDIDATE_PATHS = [
  config.agyExecutable,
  join(homedir(), '.local/bin/agy'),
  join(homedir(), '.gemini/antigravity-cli/bin/agy'),
  '/usr/local/bin/agy',
  '/usr/bin/agy'
];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findAgyExecutable(): Promise<string> {
  if (config.agyExecutable && config.agyExecutable !== 'agy') {
    if (await isExecutable(config.agyExecutable)) return config.agyExecutable;
  }
  for (const candidate of CANDIDATE_PATHS) {
    if (candidate && candidate !== 'agy' && await isExecutable(candidate)) {
      return candidate;
    }
  }
  return config.agyExecutable || 'agy';
}

export async function agyIsAvailable(): Promise<boolean> {
  const binary = await findAgyExecutable();
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    try {
      const child = spawn(binary, ['--help'], {
        stdio: 'ignore'
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        finish(false);
      }, 5_000);

      child.once('error', () => {
        clearTimeout(timeout);
        finish(false);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

import { resolvePromptPath } from './prompts.js';

export async function resolvePromptMarkdownPath(): Promise<string> {
  return resolvePromptPath('analyse_justificatif.md');
}

function parseAgyJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Le CLI agy n'a retourné aucun contenu.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const jsonMatch = /\{[\s\S]*\}/.exec(trimmed);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`La sortie de agy n'est pas un JSON valide : ${trimmed.slice(0, 200)}`);
  }

  if (parsed.structured_output && typeof parsed.structured_output === 'object') {
    return parsed.structured_output;
  }

  if (typeof parsed.response === 'string') {
    const responseText = parsed.response.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(responseText)?.[1];
    try {
      return JSON.parse((fenced ?? responseText).trim());
    } catch {
      // Continue
    }
  }

  return parsed;
}

function isAgyAuthPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('authentication required') ||
    lower.includes('visit the url to log in') ||
    lower.includes('paste the authorization code') ||
    lower.includes('not logged in') ||
    lower.includes('please visit the url')
  );
}

export async function analyzeDocumentWithAgy(options: AgyDocumentAnalysisOptions): Promise<unknown> {
  const binary = await findAgyExecutable();
  const markdownPath = await resolvePromptMarkdownPath();
  const workDir = await mkdtemp(join(tmpdir(), 'treso-agy-'));
  const schemaPath = join(workDir, 'invoice-schema.json');
  await writeFile(schemaPath, JSON.stringify(INVOICE_SCHEMA, null, 2), { mode: 0o600 });

  const directoriesToAdd = new Set<string>();
  directoriesToAdd.add(dirname(markdownPath));

  let promptTarget = '';
  if (options.filePath) {
    directoriesToAdd.add(dirname(options.filePath));
    promptTarget = `Consulte directement le document justificatif suivant : "${options.filePath}".`;
  } else {
    promptTarget = 'Consulte les informations du document fourni ci-dessous.';
  }

  let ocrSection = '';
  if (options.ocrText && options.ocrText.trim()) {
    ocrSection = `\n\nTexte brut extrait par l'OCR local (à titre d'indice complémentaire) :\n${options.ocrText.trim().slice(0, 4000)}`;
  }

  const prompt = `Lis et respecte scrupuleusement les instructions du fichier Markdown "${markdownPath}".\n${promptTarget}${ocrSection}\n\nExtrais les informations de la pièce justificative selon le schéma JSON demandé.`;

  const args: string[] = [
    '--print', prompt,
    '--dangerously-skip-permissions',
    '--json-schema', schemaPath,
    '--output-format', 'json'
  ];

  for (const dir of directoriesToAdd) {
    args.push('--add-dir', dir);
  }

  if (options.model && options.model.trim()) {
    args.push('--model', options.model.trim());
  }

  try {
    const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(binary, args, {
        cwd: workDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdoutData = '';
      let stderrData = '';
      let finished = false;

      const checkAuth = (data: string) => {
        if (!finished && isAgyAuthPrompt(data)) {
          finished = true;
          clearTimeout(timeout);
          child.kill('SIGTERM');
          rejectPromise(new Error("Le CLI agy n'est pas encore connecté à votre compte Google. Ouvrez le terminal interactif dans les paramètres de configuration pour vous identifier."));
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf8');
        checkAuth(stdoutData);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf8');
        checkAuth(stderrData);
      });

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 3_000).unref();
        rejectPromise(new Error("Le délai maximal d'exécution de agy (120 secondes) a été dépassé."));
      }, 120_000);

      child.once('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        rejectPromise(new Error(`Impossible d'exécuter agy (${binary}) : ${err.message}`));
      });

      child.once('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolvePromise(stdoutData);
        } else {
          const detail = stderrData.trim() || stdoutData.trim() || `Code de sortie ${code}`;
          rejectPromise(new Error(`agy a échoué (${detail})`));
        }
      });
    });

    return parseAgyJsonOutput(stdout);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function testAgyConnection(model?: string): Promise<{ success: boolean; message: string }> {
  const binary = await findAgyExecutable();
  const available = await agyIsAvailable();
  if (!available) {
    return {
      success: false,
      message: `Le binaire agy n'est pas accessible (${binary}). Vérifiez l'installation du CLI.`
    };
  }

  const args = ['--print', 'Réponds uniquement par "OK" si tu es opérationnel.', '--output-format', 'text'];
  if (model && model.trim()) {
    args.push('--model', model.trim());
  }

  return new Promise((resolvePromise) => {
    try {
      const child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      let stderr = '';
      let finished = false;

      const checkAuth = (data: string) => {
        if (!finished && isAgyAuthPrompt(data)) {
          finished = true;
          clearTimeout(timeout);
          child.kill('SIGTERM');
          resolvePromise({
            success: false,
            message: "Le CLI agy requiert une première authentification. Ouvrez le terminal interactif (« Ouvrir le terminal / TUI agy ») pour vous connecter à votre compte Google."
          });
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        checkAuth(output);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        checkAuth(stderr);
      });

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGTERM');
        resolvePromise({
          success: false,
          message: 'Le test agy a expiré (délai dépassé).'
        });
      }, 25_000);

      child.once('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        resolvePromise({
          success: false,
          message: `Erreur d'exécution agy : ${err.message}`
        });
      });

      child.once('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (code === 0 && output.trim()) {
          resolvePromise({
            success: true,
            message: `Connexion agy réussie avec le modèle ${model || 'par défaut'} (${output.trim().slice(0, 50)}).`
          });
        } else {
          const detail = stderr.trim() || output.trim() || 'inconnue';
          resolvePromise({
            success: false,
            message: isAgyAuthPrompt(detail)
              ? "Le CLI agy requiert une première authentification. Ouvrez le terminal interactif (« Ouvrir le terminal / TUI agy ») pour vous connecter à votre compte Google."
              : `Le CLI agy a retourné une erreur (code ${code}) : ${detail}`
          });
        }
      });
    } catch (err) {
      resolvePromise({
        success: false,
        message: `Échec du lancement agy : ${err instanceof Error ? err.message : String(err)}`
      });
    }
  });
}

export async function agyIsAuthenticated(): Promise<boolean> {
  const tokenCandidates = [
    join(homedir(), '.gemini/antigravity-cli/antigravity-oauth-token'),
    '/home/node/.gemini/antigravity-cli/antigravity-oauth-token'
  ];
  for (const path of tokenCandidates) {
    try {
      await access(path, constants.R_OK);
      const content = await readFile(path, 'utf8');
      const json = JSON.parse(content) as Record<string, unknown>;
      const token = json.token as Record<string, unknown> | undefined;
      if (token?.access_token || token?.refresh_token) {
        return true;
      }
    } catch {
      // Continuer
    }
  }
  return false;
}

export async function executeAgyTextPrompt(prompt: string, model?: string): Promise<string> {
  const binary = await findAgyExecutable();
  const workDir = await mkdtemp(join(tmpdir(), 'treso-agy-report-'));

  const args: string[] = [
    '--print', prompt,
    '--output-format', 'text',
    '--dangerously-skip-permissions'
  ];
  if (model && model.trim()) {
    args.push('--model', model.trim());
  }

  try {
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(binary, args, {
        cwd: workDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const checkAuth = (data: string) => {
        if (!finished && isAgyAuthPrompt(data)) {
          finished = true;
          clearTimeout(timeout);
          child.kill('SIGTERM');
          rejectPromise(new Error("Le CLI agy n'est pas authentifié. Veuillez vous connecter dans Configuration > Terminal."));
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        checkAuth(stdout);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        checkAuth(stderr);
      });

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGTERM');
        rejectPromise(new Error("Le délai maximal d'exécution de agy (120 secondes) a été dépassé."));
      }, 120_000);

      child.once('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        rejectPromise(new Error(`Impossible d'exécuter agy (${binary}) : ${err.message}`));
      });

      child.once('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          resolvePromise(stdout.trim());
        } else {
          rejectPromise(new Error(stderr.trim() || stdout.trim() || `agy a quitté avec le code ${code}`));
        }
      });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}


