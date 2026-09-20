<script lang="ts">
  export let name: 'dashboard' | 'wallet' | 'transfer' | 'invoice' | 'tag' | 'folder' | 'settings' | 'scan' | 'menu' | 'close' | 'logout' | 'plus' | 'camera' | 'upload' | 'check' | 'chevron' | 'alert' | 'refresh' = 'dashboard';
  export let size = 20;
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'dashboard'}<path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />
  {:else if name === 'wallet'}<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v12H5.5A2.5 2.5 0 0 1 3 16.5v-9Z"/><path d="M3 8h16M16 12h5v4h-5a2 2 0 0 1 0-4Z"/>
  {:else if name === 'transfer'}<path d="M4 7h14m0 0-3-3m3 3-3 3M20 17H6m0 0 3 3m-3-3 3-3"/>
  {:else if name === 'invoice'}<path d="M6 3h9l3 3v15H6V3Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>
  {:else if name === 'tag'}<path d="m20 13-7 7-9-9V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1"/>
  {:else if name === 'folder'}<path d="M3 6h7l2 2h9v11H3V6Z"/>
  {:else if name === 'settings'}<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.35.7.6 1 .3.29.68.43 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6Z"/>
  {:else if name === 'scan'}<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10M9 9h6M9 15h6"/>
  {:else if name === 'menu'}<path d="M4 7h16M4 12h16M4 17h16"/>
  {:else if name === 'close'}<path d="m6 6 12 12M18 6 6 18"/>
  {:else if name === 'logout'}<path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10"/>
  {:else if name === 'plus'}<path d="M12 5v14M5 12h14"/>
  {:else if name === 'camera'}<path d="M4 8h4l2-3h4l2 3h4v11H4V8Z"/><circle cx="12" cy="13" r="3"/>
  {:else if name === 'upload'}<path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v6h14v-6"/>
  {:else if name === 'check'}<path d="m5 12 4 4L19 6"/>
  {:else if name === 'chevron'}<path d="m9 18 6-6-6-6"/>
  {:else if name === 'alert'}<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5m0 3h.01"/>
  {:else if name === 'refresh'}<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10-4L4 12m2 0a6 6 0 0 0 10 4l4-4"/>{/if}
</svg>
