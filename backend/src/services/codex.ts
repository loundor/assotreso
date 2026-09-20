import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config } from '../config.js';

const CODEX_EXECUTABLE = resolve('node_modules/.bin/codex');
const DEVICE_URL_PATTERN = /https:\/\/auth\.openai\.com\/codex\/device/;
const DEVICE_CODE_PATTERN = /(?:^|[^A-Z0-9])([A-Z0-9]{4}-[A-Z0-9]{4,8})(?=$|[^A-Z0-9])/m;
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const DEVICE_LOGIN_EXPIRES_MS = 15 * 60 * 1_000;
const DEVICE_LOGIN_STARTUP_MS = 20_000;
const TERMINAL_FLOW_RETENTION_MS = 60_000;

interface DeviceLoginFlow {
  child: ReturnType<typeof spawn>;
  status: 'pending' | 'connected' | 'error';
  authorizationUrl: string;
  userCode: string;
  cancelled: boolean;
  finalized: boolean;
  startSettled: boolean;
  rejectStart?: ((reason: Error) => void) | undefined;
  message?: string;
  startupTimer?: NodeJS.Timeout | undefined;
  expiryTimer?: NodeJS.Timeout | undefined;
  cleanupTimer?: NodeJS.Timeout | undefined;
  terminationTimer?: NodeJS.Timeout | undefined;
}

const loginFlows = new Map<string, DeviceLoginFlow>();

function codexEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: config.codexHome };
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

function clearFlowTimers(flow: DeviceLoginFlow): void {
  if (flow.startupTimer) clearTimeout(flow.startupTimer);
  if (flow.expiryTimer) clearTimeout(flow.expiryTimer);
  flow.startupTimer = undefined;
  flow.expiryTimer = undefined;
}

function terminateChild(flow: DeviceLoginFlow): void {
  if (flow.child.exitCode !== null || flow.child.signalCode !== null) return;
  flow.child.kill('SIGTERM');
  flow.terminationTimer = setTimeout(() => {
    if (flow.child.exitCode === null && flow.child.signalCode === null) flow.child.kill('SIGKILL');
  }, 5_000);
  flow.terminationTimer.unref();
}

function scheduleFlowCleanup(state: string, flow: DeviceLoginFlow, delay = TERMINAL_FLOW_RETENTION_MS): void {
  if (flow.cleanupTimer) clearTimeout(flow.cleanupTimer);
  flow.cleanupTimer = setTimeout(() => {
    if (loginFlows.get(state) === flow) loginFlows.delete(state);
  }, delay);
  flow.cleanupTimer.unref();
}

function cancelFlow(state: string, flow: DeviceLoginFlow): void {
  if (flow.status !== 'pending' || flow.finalized) return;
  flow.cancelled = true;
  flow.finalized = true;
  flow.status = 'error';
  flow.message = 'Cette demande de connexion OpenAI a été remplacée par une nouvelle tentative.';
  if (!flow.startSettled) {
    flow.startSettled = true;
    flow.rejectStart?.(new Error(flow.message));
  }
  clearFlowTimers(flow);
  terminateChild(flow);
  scheduleFlowCleanup(state, flow);
}

function deviceLoginFailureMessage(output: string, code: number | null): string {
  const normalized = stripAnsi(output).toLowerCase();
  if (/certificate|unknown issuer|tls|ssl/.test(normalized)) {
    return "Codex n'a pas pu vérifier le certificat du service OpenAI. Vérifiez les certificats CA du serveur.";
  }
  if (/error sending request|connection refused|connection reset|dns|network|timed out/.test(normalized)) {
    return "Codex n'a pas pu joindre le service d'authentification OpenAI. Vérifiez la connectivité HTTPS du serveur.";
  }
  if (/denied|declined|refused|cancelled/.test(normalized)) {
    return "La connexion OpenAI a été refusée ou annulée.";
  }
  if (/expired/.test(normalized)) return 'Le code temporaire OpenAI a expiré. Recommencez la connexion.';
  if (code === null) return 'La connexion OpenAI a été interrompue.';
  return `Codex n'a pas finalisé la connexion OpenAI (code de sortie ${code}).`;
}

export async function startCodexDeviceLogin(
  state: string,
  onConnected: () => Promise<void>,
  onError: (message: string) => Promise<void>
): Promise<{ authorizationUrl: string; userCode: string; expiresIn: number }> {
  for (const [existingState, existingFlow] of loginFlows) cancelFlow(existingState, existingFlow);

  const child = spawn(CODEX_EXECUTABLE, ['login', '--device-auth'], {
    env: codexEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const flow: DeviceLoginFlow = {
    child,
    status: 'pending',
    authorizationUrl: '',
    userCode: '',
    cancelled: false,
    finalized: false,
    startSettled: false
  };
  loginFlows.set(state, flow);

  let output = '';
  let resolveStart: ((value: { authorizationUrl: string; userCode: string; expiresIn: number }) => void) | undefined;
  const started = new Promise<{ authorizationUrl: string; userCode: string; expiresIn: number }>((resolvePromise, rejectPromise) => {
    resolveStart = resolvePromise;
    flow.rejectStart = rejectPromise;
  });

  const reportError = async (message: string): Promise<void> => {
    try {
      await onError(message);
    } catch {
      // Le statut en mémoire reste exploitable sans exposer l'erreur SQL ou les sorties Codex.
    }
  };

  const failFlow = (message: string): void => {
    if (flow.cancelled || flow.finalized) return;
    flow.finalized = true;
    flow.status = 'error';
    flow.message = message;
    clearFlowTimers(flow);
    if (!flow.startSettled) {
      flow.startSettled = true;
      flow.rejectStart?.(new Error(message));
    }
    scheduleFlowCleanup(state, flow);
    void reportError(message);
  };

  const consume = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-16_000);
    const cleanOutput = stripAnsi(output);
    const authorizationUrl = cleanOutput.match(DEVICE_URL_PATTERN)?.[0];
    const userCode = cleanOutput.match(DEVICE_CODE_PATTERN)?.[1];
    if (!flow.startSettled && authorizationUrl && userCode) {
      flow.startSettled = true;
      flow.authorizationUrl = authorizationUrl;
      flow.userCode = userCode;
      if (flow.startupTimer) clearTimeout(flow.startupTimer);
      flow.startupTimer = undefined;
      resolveStart?.({ authorizationUrl, userCode, expiresIn: DEVICE_LOGIN_EXPIRES_MS / 1_000 });
    }
  };
  child.stdout.on('data', consume);
  child.stderr.on('data', consume);

  flow.startupTimer = setTimeout(() => {
    if (flow.startSettled || flow.finalized || flow.cancelled) return;
    const cleanOutput = stripAnsi(output);
    const sawUrl = DEVICE_URL_PATTERN.test(cleanOutput);
    const message = sawUrl
      ? "Codex a fourni le lien OpenAI, mais le format du code temporaire n'a pas été reconnu."
      : cleanOutput.trim()
        ? deviceLoginFailureMessage(cleanOutput, null)
        : "Codex n'a fourni ni lien ni code temporaire OpenAI dans le délai attendu.";
    terminateChild(flow);
    failFlow(message);
  }, DEVICE_LOGIN_STARTUP_MS);

  flow.expiryTimer = setTimeout(() => {
    if (flow.finalized || flow.cancelled) return;
    terminateChild(flow);
    failFlow('Le code temporaire OpenAI a expiré. Recommencez la connexion.');
  }, DEVICE_LOGIN_EXPIRES_MS);
  flow.expiryTimer.unref();

  child.once('error', () => {
    failFlow("Le composant officiel Codex n'a pas pu être démarré.");
  });

  child.once('close', (code) => {
    if (flow.terminationTimer) clearTimeout(flow.terminationTimer);
    flow.terminationTimer = undefined;
    if (flow.cancelled || flow.finalized) return;
    if (code !== 0) {
      failFlow(deviceLoginFailureMessage(output, code));
      return;
    }

    flow.finalized = true;
    clearFlowTimers(flow);
    void (async () => {
      try {
        if (!(await codexIsAuthenticated())) {
          flow.status = 'error';
          flow.message = "Codex a terminé la connexion, mais aucune authentification OpenAI valide n'a été trouvée.";
          await reportError(flow.message);
          scheduleFlowCleanup(state, flow);
          return;
        }
        await onConnected();
        flow.status = 'connected';
        flow.message = 'OpenAI est connecté avec votre compte ChatGPT.';
        if (loginFlows.get(state) === flow) loginFlows.delete(state);
      } catch {
        flow.status = 'error';
        flow.message = "La connexion OpenAI a réussi, mais son enregistrement sur le serveur a échoué.";
        await reportError(flow.message);
        scheduleFlowCleanup(state, flow);
      }
    })();
  });

  return started;
}

export function codexDeviceLoginStatus(state: string): { status: 'pending' | 'connected' | 'error'; message?: string } | null {
  const flow = loginFlows.get(state);
  if (!flow) return null;
  return flow.message ? { status: flow.status, message: flow.message } : { status: flow.status };
}

export async function codexIsAuthenticated(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(CODEX_EXECUTABLE, ['login', 'status'], {
      env: codexEnvironment(),
      stdio: 'ignore'
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let killTimeout: NodeJS.Timeout | undefined;
    const finish = (authenticated: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolvePromise(authenticated);
    };
    timeout = setTimeout(() => {
      child.kill('SIGTERM');
      killTimeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2_000);
      killTimeout.unref();
    }, 10_000);
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
  });
}

const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
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

export async function analyzeInvoiceWithCodex(ocrText: string, model: string): Promise<unknown> {
  const workDir = await mkdtemp(join(tmpdir(), 'treso-codex-'));
  const schemaPath = join(workDir, 'invoice-schema.json');
  const outputPath = join(workDir, 'result.json');
  await writeFile(schemaPath, JSON.stringify(INVOICE_SCHEMA), { mode: 0o600 });

  const prompt = `Analyse uniquement le texte OCR de facture fourni ci-dessous. N'utilise aucun outil et ne lis aucun fichier. Retourne les champs demandés selon le schéma JSON. Les montants sont des nombres en euros, invoiceDate utilise YYYY-MM-DD et une donnée inconnue vaut null.\n\nTEXTE OCR :\n${ocrText}`;

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(CODEX_EXECUTABLE, [
        'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--output-schema', schemaPath,
        '--output-last-message', outputPath, '--model', model, '-'
      ], {
        cwd: workDir,
        env: codexEnvironment(),
        stdio: ['pipe', 'ignore', 'pipe']
      });
      let errorOutput = '';
      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput = `${errorOutput}${chunk.toString('utf8')}`.slice(-4_000);
      });
      const timeout = setTimeout(() => child.kill('SIGTERM'), 90_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(errorOutput.trim() || `Codex a quitté avec le code ${code}.`));
      });
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
