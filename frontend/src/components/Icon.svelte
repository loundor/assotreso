<script lang="ts">
  export let name: 'dashboard' | 'wallet' | 'transfer' | 'invoice' | 'tag' | 'folder' | 'settings' | 'scan' | 'menu' | 'close' | 'logout' | 'plus' | 'camera' | 'upload' | 'download' | 'check' | 'chevron' | 'chevron-left' | 'chevron-right' | 'arrow-left' | 'arrow-right' | 'alert' | 'refresh' | 'link' | 'trash' | 'edit' | 'report' | 'print' = 'dashboard';
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
  {:else if name === 'download'}<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  {:else if name === 'check'}<path d="m5 12 4 4L19 6"/>
  {:else if name === 'chevron' || name === 'chevron-right'}<path d="m9 18 6-6-6-6"/>
  {:else if name === 'chevron-left'}<path d="m15 18-6-6 6-6"/>
  {:else if name === 'arrow-left'}<path d="M19 12H5M12 19l-7-7 7-7"/>
  {:else if name === 'arrow-right'}<path d="M5 12h14M12 5l7 7-7 7"/>
  {:else if name === 'alert'}<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5m0 3h.01"/>
  {:else if name === 'refresh'}<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10-4L4 12m2 0a6 6 0 0 0 10 4l4-4"/>
  {:else if name === 'link'}<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  {:else if name === 'trash'}<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
  {:else if name === 'edit'}<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  {:else if name === 'report'}<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>
  {:else if name === 'print'}<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>{/if}
</svg>
