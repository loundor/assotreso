import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { findAgyExecutable } from './agy.js';

export interface TerminalSession {
  id: string;
  child: ChildProcess;
  history: string;
  listeners: Set<(chunk: string) => void>;
  closeListeners: Set<(code: number | null) => void>;
  closed: boolean;
  exitCode: number | null;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

const sessions = new Map<string, TerminalSession>();
const MAX_HISTORY_BYTES = 64 * 1024;
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;

async function hasScriptUtility(): Promise<boolean> {
  try {
    await access('/usr/bin/script', constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function startAgyTerminalSession(options?: { cols?: number | undefined; rows?: number | undefined }): Promise<TerminalSession> {
  const binary = await findAgyExecutable();
  const id = randomUUID();
  const useScript = await hasScriptUtility();

  const cols = Math.min(250, Math.max(40, options?.cols ?? 100));
  const rows = Math.min(100, Math.max(10, options?.rows ?? 30));

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: String(cols),
    LINES: String(rows)
  };

  let child: ChildProcess;
  if (useScript) {
    const cmd = `export TERM=xterm-256color; stty rows ${rows} cols ${cols} 2>/dev/null; exec "${binary}"`;
    child = spawn('/usr/bin/script', ['-q', '-f', '-c', cmd, '/dev/null'], {
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } else {
    child = spawn(binary, [], {
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  const session: TerminalSession = {
    id,
    child,
    history: '',
    listeners: new Set(),
    closeListeners: new Set(),
    closed: false,
    exitCode: null,
    write(data: string) {
      if (session.closed || child.stdin?.destroyed) return;
      child.stdin?.write(data);
    },
    resize(cols: number, rows: number) {
      if (session.closed || !child.pid) return;
      try {
        const targetCols = Math.min(250, Math.max(40, cols));
        const targetRows = Math.min(100, Math.max(10, rows));
        const subpids = execSync(`pgrep -P ${child.pid}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n');
        for (const subpid of subpids) {
          if (!subpid) continue;
          try {
            const pts = readlinkSync(`/proc/${subpid}/fd/0`);
            if (pts.startsWith('/dev/pts/')) {
              execSync(`stty -F ${pts} rows ${targetRows} cols ${targetCols}`);
              break;
            }
          } catch {
            // Continuer
          }
        }
      } catch {
        // Ignorer
      }
    },
    kill() {
      if (session.closed) return;
      session.closed = true;
      try {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null && child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                child.kill('SIGKILL');
              }
            }
          }, 2_000).unref();
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // Ignorer
      }
      sessions.delete(id);
    }
  };

  sessions.set(id, session);

  const onData = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    session.history = (session.history + text).slice(-MAX_HISTORY_BYTES);
    for (const listener of session.listeners) {
      try {
        listener(text);
      } catch {
        // Ignorer les erreurs d'abonnés
      }
    }
  };

  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  child.once('close', (code) => {
    session.closed = true;
    session.exitCode = code;
    for (const closeListener of session.closeListeners) {
      try {
        closeListener(code);
      } catch {
        // Ignorer
      }
    }
    setTimeout(() => {
      sessions.delete(id);
    }, 60_000).unref();
  });

  child.once('error', (err) => {
    onData(Buffer.from(`\r\n[Erreur de démarrage du terminal: ${err.message}]\r\n`));
  });

  setTimeout(() => {
    if (sessions.get(id) === session) {
      session.kill();
    }
  }, INACTIVITY_TIMEOUT_MS).unref();

  return session;
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}
