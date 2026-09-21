<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import Icon from './Icon.svelte';
  import { api, getToken } from '../lib/api';

  export let onClose: () => void = () => {};

  let terminalContainer: HTMLDivElement | null = null;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let sessionId = '';
  let eventSource: EventSource | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let statusText = 'Connexion au terminal du serveur...';
  let starting = false;

  async function startSession() {
    statusText = 'Démarrage de agy...';
    starting = true;
    terminal?.clear();
    try {
      if (sessionId) {
        await api.post(`config/ai/terminal/${sessionId}/stop`, {}).catch(() => undefined);
      }
      if (eventSource) {
        eventSource.close();
      }

      const cols = terminal?.cols || 100;
      const rows = terminal?.rows || 30;
      const res = await api.post<{ sessionId: string }>('config/ai/terminal/start', { cols, rows });
      sessionId = res.sessionId;
      statusText = 'Connexion au flux en direct...';

      const token = getToken();
      const streamUrl = `/api/config/ai/terminal/${sessionId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        statusText = 'Session agy active';
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; data?: string; code?: number };
          if (payload.type === 'output' && payload.data) {
            terminal?.write(payload.data);
          } else if (payload.type === 'exit') {
            terminal?.writeln(`\r\n\x1b[33m[Session terminée (code ${payload.code})]\x1b[0m\r\n`);
            statusText = 'Session terminée';
          }
        } catch {
          // Format brut
          terminal?.write(event.data);
        }
      };

      eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) {
          statusText = 'Flux déconnecté';
        } else {
          statusText = 'Reconnexion au flux...';
        }
      };
    } catch (err) {
      statusText = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
      terminal?.writeln(`\r\n\x1b[31m[Erreur de connexion : ${statusText}]\x1b[0m\r\n`);
    } finally {
      starting = false;
    }
  }

  function handleClose() {
    if (sessionId) {
      void api.post(`config/ai/terminal/${sessionId}/stop`, {}).catch(() => undefined);
    }
    if (eventSource) {
      eventSource.close();
    }
    onClose();
  }

  onMount(() => {
    if (!terminalContainer) return;

    terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#131e1a',
        foreground: '#e4ece8',
        cursor: '#f0bd6c',
        selectionBackground: '#2d4d42'
      }
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainer);
    fitAddon.fit();
    setTimeout(() => {
      fitAddon?.fit();
      terminal?.focus();
    }, 100);

    terminal.onData((data) => {
      if (!sessionId) return;
      void api.post(`config/ai/terminal/${sessionId}/input`, { data }).catch(() => undefined);
    });

    terminal.onResize(({ cols, rows }) => {
      if (!sessionId) return;
      void api.post(`config/ai/terminal/${sessionId}/resize`, { cols, rows }).catch(() => undefined);
    });

    void startSession();

    const handleResize = () => {
      fitAddon?.fit();
      if (sessionId && terminal) {
        void api.post(`config/ai/terminal/${sessionId}/resize`, { cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
      }
    };
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalContainer);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  onDestroy(() => {
    if (sessionId) {
      void api.post(`config/ai/terminal/${sessionId}/stop`, {}).catch(() => undefined);
    }
    if (eventSource) {
      eventSource.close();
    }
    resizeObserver?.disconnect();
    terminal?.dispose();
  });
</script>

<div class="terminal-overlay" role="dialog" aria-modal="true" aria-labelledby="terminal-title">
  <div class="terminal-modal">
    <header class="terminal-header">
      <div class="terminal-title-area">
        <Icon name="settings" size={20}/>
        <h3 id="terminal-title">Terminal interactif CLI / TUI (Antigravity agy)</h3>
        <span class="terminal-status-badge">{statusText}</span>
      </div>
      <div class="terminal-actions">
        <button class="btn btn-secondary btn-sm" disabled={starting} on:click={startSession}>
          Relancer agy
        </button>
        <button class="btn btn-secondary btn-sm" on:click={handleClose}>
          Fermer
        </button>
      </div>
    </header>

    <div class="terminal-instructions">
      <p>
        <strong>Première connexion :</strong> Si <code>agy</code> vous demande de vous authentifier, suivez le lien ou saisissez le code affiché directement dans le terminal ci-dessous.
        Une fois l'authentification validée, fermez cette fenêtre puis cliquez sur <em>« Tester la connexion »</em>.
      </p>
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="terminal-body"
      bind:this={terminalContainer}
      on:click={() => terminal?.focus()}
      role="region"
      aria-label="Terminal agy"
      tabindex="0"
    ></div>
  </div>
</div>

<style>
  .terminal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10, 25, 20, 0.75);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(0.5rem, 2vw, 1.5rem);
  }
  .terminal-modal {
    background: #131e1a;
    color: #e4ece8;
    border: 1px solid #2d4d42;
    border-radius: 16px;
    width: 100%;
    max-width: 1100px;
    min-height: min(520px, calc(100dvh - 1rem));
    height: min(85dvh, 820px);
    max-height: calc(100dvh - 1rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.85rem 1.2rem;
    background: #1c2c26;
    border-bottom: 1px solid #2d4d42;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .terminal-title-area {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: 1 1 420px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .terminal-title-area h3 {
    font-size: 0.95rem;
    margin: 0;
    color: #f7f3e8;
  }
  .terminal-status-badge {
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    background: #243831;
    color: #a8d5c2;
    border-radius: 99px;
    font-weight: 600;
  }
  .terminal-actions {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }
  .terminal-instructions {
    background: #182621;
    border-bottom: 1px solid #283e35;
    padding: 0.65rem 1.2rem;
    font-size: 0.8rem;
    color: #b7cbbf;
  }
  .terminal-instructions p {
    margin: 0;
  }
  .terminal-instructions code {
    background: #23372f;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    color: #f0bd6c;
  }
  .terminal-instructions em {
    color: #f7f3e8;
    font-style: normal;
    font-weight: bold;
  }
  .terminal-body {
    flex: 1;
    padding: 0.5rem;
    background: #131e1a;
    min-height: 0;
    overflow: hidden;
  }
  @media (max-width: 640px) {
    .terminal-overlay { align-items: stretch; padding: 0; }
    .terminal-modal { min-height: 100dvh; height: 100dvh; max-height: 100dvh; border-radius: 0; border-width: 0; }
    .terminal-header { align-items: stretch; padding: 0.75rem; }
    .terminal-title-area { flex-basis: 100%; }
    .terminal-title-area h3 { flex: 1; min-width: 180px; }
    .terminal-status-badge { width: 100%; border-radius: 6px; }
    .terminal-actions { width: 100%; }
    .terminal-actions .btn { flex: 1 1 130px; }
    .terminal-instructions { padding: 0.6rem 0.75rem; max-height: 110px; overflow-y: auto; }
    .terminal-body { padding: 0.25rem; }
  }
  @media (max-height: 560px) and (orientation: landscape) {
    .terminal-instructions { display: none; }
    .terminal-modal { min-height: calc(100dvh - 0.5rem); height: calc(100dvh - 0.5rem); }
  }
</style>
