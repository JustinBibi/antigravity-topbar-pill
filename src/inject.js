// Script injected into the Antigravity Electron renderer via CDP

export const INJECTED_SCRIPT = `(() => {
  window.__AG_TOPBAR_ENABLED__ = true;

  if (window.__AG_TOPBAR_INITIALIZED__) {
    if (typeof window.__AG_TOPBAR_ATTACH__ === 'function') {
      window.__AG_TOPBAR_ATTACH__();
    }
    return;
  }
  window.__AG_TOPBAR_INITIALIZED__ = true;

  if (window.__AG_TOPBAR_OBSERVER__) {
    try { window.__AG_TOPBAR_OBSERVER__.disconnect(); } catch {}
    window.__AG_TOPBAR_OBSERVER__ = null;
  }

  let hasReceivedData = false;

  let currentData = {
    conversationId: null,
    percentStr: '0%',
    tokenStr: '0',
    dotColor: '#10b981',
    model: 'Gemini',
    inputStr: '0',
    cachedStr: '0',
    outputStr: '0',
    contextStr: '0 / 1M',
    hasTokens: false
  };

  function ensureStyles() {
    if (document.getElementById('ag-topbar-styles')) return;
    const style = document.createElement('style');
    style.id = 'ag-topbar-styles';
    style.textContent = \`
      #ag-topbar-token-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 26px;
        padding: 0 4px;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-weight: 500;
        color: var(--foreground, #222);
        background: transparent;
        border: none;
        cursor: pointer;
        user-select: none;
        position: relative;
        app-region: no-drag !important;
        -webkit-app-region: no-drag !important;
      }
      #ag-topbar-token-badge .ag-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
        flex-shrink: 0;
        transition: background 0.2s ease;
      }
      #ag-topbar-tooltip {
        position: fixed;
        display: none;
        min-width: 210px;
        padding: 10px 14px;
        background: var(--card, #ffffff);
        color: var(--foreground, #111827);
        border: 1px solid var(--border, rgba(128,128,128,0.25));
        border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.16);
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        line-height: 1.6;
        z-index: 999999;
        pointer-events: none;
        app-region: no-drag !important;
        -webkit-app-region: no-drag !important;
      }
      .ag-tt-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3px;
      }
      .ag-tt-label {
        color: var(--muted-foreground, #6b7280);
      }
      .ag-tt-val {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-weight: 500;
        color: var(--foreground, #111);
      }
      .ag-tt-divider {
        height: 1px;
        background: var(--border, rgba(128,128,128,0.14));
        margin: 6px 0;
      }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTooltip() {
    let tooltip = document.getElementById('ag-topbar-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'ag-topbar-tooltip';
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTooltipContent(tooltip) {
    tooltip.innerHTML = \`
      <div class="ag-tt-row" style="margin-bottom: 5px;">
        <span class="ag-tt-label">Model</span>
        <span class="ag-tt-val" style="font-family: inherit; font-weight: 600;">\${escapeHtml(currentData.model)}</span>
      </div>
      <div class="ag-tt-divider"></div>
      <div class="ag-tt-row">
        <span class="ag-tt-label">Input</span>
        <span class="ag-tt-val">\${escapeHtml(currentData.inputStr)}</span>
      </div>
      <div class="ag-tt-row">
        <span class="ag-tt-label">Cached</span>
        <span class="ag-tt-val">\${escapeHtml(currentData.cachedStr)}</span>
      </div>
      <div class="ag-tt-row">
        <span class="ag-tt-label">Output</span>
        <span class="ag-tt-val">\${escapeHtml(currentData.outputStr)}</span>
      </div>
      <div class="ag-tt-divider"></div>
      <div class="ag-tt-row">
        <span class="ag-tt-label">Context Used</span>
        <span class="ag-tt-val" style="font-weight: 600; color: \${escapeHtml(currentData.dotColor)};">\${escapeHtml(currentData.contextStr)}</span>
      </div>
    \`;
  }

  function attachBadge() {
    if (!window.__AG_TOPBAR_ENABLED__ || !hasReceivedData) return false;
    if (!currentData.conversationId) return false;
    ensureStyles();

    // Locate target toolbar container
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"] > div') ||
                    document.querySelector('[data-testid="pane-titlebar-toolbar"]') ||
                    document.querySelector('[class*="titlebar"]');

    if (!toolbar) return false;

    // Check if badge already attached in this toolbar and in DOM
    const existingBadge = document.getElementById('ag-topbar-token-badge');
    if (existingBadge && existingBadge.parentElement === toolbar && document.body.contains(existingBadge)) {
      existingBadge.style.display = 'inline-flex';
      return true;
    }

    if (existingBadge) {
      try { existingBadge.remove(); } catch {}
    }

    const badge = document.createElement('div');
    badge.id = 'ag-topbar-token-badge';
    badge.style.display = 'inline-flex';
    badge.innerHTML = \`
      <span class="ag-dot" style="background: \${escapeHtml(currentData.dotColor)};"></span>
      <span id="ag-topbar-badge-text">\${escapeHtml(currentData.percentStr)} · \${escapeHtml(currentData.tokenStr)}</span>
    \`;

    // Position tooltip on hover
    badge.addEventListener('mouseenter', () => {
      if (!window.__AG_TOPBAR_ENABLED__) return;
      const tooltip = getTooltip();
      renderTooltipContent(tooltip);
      const rect = badge.getBoundingClientRect();
      tooltip.style.left = 'auto';
      tooltip.style.top = (rect.bottom + 6) + 'px';
      tooltip.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
      tooltip.style.display = 'block';
    });

    badge.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('ag-topbar-tooltip');
      if (tooltip) tooltip.style.display = 'none';
    });

    toolbar.insertBefore(badge, toolbar.firstChild);
    return true;
  }

  window.__AG_TOPBAR_ATTACH__ = attachBadge;

  window.__AG_TOPBAR_UPDATE__ = (data) => {
    if (!window.__AG_TOPBAR_ENABLED__) return;
    hasReceivedData = true;
    currentData = Object.assign(currentData, data);

    const badge = document.getElementById('ag-topbar-token-badge');
    if (!currentData.conversationId) {
      if (badge) badge.style.display = 'none';
      return;
    }

    attachBadge();
    const activeBadge = document.getElementById('ag-topbar-token-badge');
    if (activeBadge) activeBadge.style.display = 'inline-flex';

    const dot = document.querySelector('#ag-topbar-token-badge .ag-dot');
    if (dot && currentData.dotColor) {
      dot.style.background = currentData.dotColor;
    }

    const textEl = document.getElementById('ag-topbar-badge-text');
    if (textEl) {
      textEl.textContent = \`\${currentData.percentStr} · \${currentData.tokenStr}\`;
    }

    const tooltip = document.getElementById('ag-topbar-tooltip');
    if (tooltip && tooltip.style.display === 'block') {
      renderTooltipContent(tooltip);
    }
  };

  window.__AG_TOPBAR_GET_STATE__ = () => {
    const path = window.location.pathname;
    let match = path.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
    let conversationId = match ? match[1] : null;

    if (!conversationId && window.location.hash) {
      match = window.location.hash.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
      if (match) conversationId = match[1];
    }

    if (!conversationId && window.location.search) {
      match = window.location.search.match(/[?&](?:conversationId|cascadeId)=([a-zA-Z0-9_-]+)/);
      if (match) conversationId = match[1];
    }

    if (!conversationId && window.__TSR_ROUTER__?.state?.matches) {
      for (const m of window.__TSR_ROUTER__.state.matches) {
        if (m.params?.cascadeId) {
          conversationId = m.params.cascadeId;
          break;
        }
        if (m.params?.conversationId) {
          conversationId = m.params.conversationId;
          break;
        }
      }
    }

    let model = null;
    const modelTrigger = document.querySelector('[data-testid="model-selector-trigger"]');
    if (modelTrigger) {
      const aria = modelTrigger.getAttribute('aria-label');
      const ariaMatch = aria && aria.match(/current:\\s*(.+)$/i);
      if (ariaMatch) {
        model = ariaMatch[1].trim();
      } else if (modelTrigger.textContent?.trim()) {
        model = modelTrigger.textContent.trim();
      }
    }

    if (!model) {
      const composerButtons = Array.from(document.querySelectorAll('.agy-composer-footer button'));
      for (const btn of composerButtons) {
        const text = btn.textContent?.trim() || '';
        if (text && !['turbo', 'normal', 'auto', 'fast'].includes(text.toLowerCase()) && text.length < 50) {
          model = text;
          break;
        }
      }
    }

    if (!model) {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const b of buttons) {
        const t = b.textContent?.trim() || '';
        if ((t.startsWith('Gemini') || t.startsWith('Claude') || t.startsWith('GPT') || t.startsWith('DeepSeek')) && t.length < 50) {
          model = t;
          break;
        }
      }
    }

    const badge = document.getElementById('ag-topbar-token-badge');
    const isAttached = !!(badge && badge.parentElement && document.body.contains(badge));

    return {
      pathname: path,
      conversationId,
      model: model || 'Gemini 3.8 Flash',
      isAttached
    };
  };

  // Listen to client-side route changes and notify daemon via CDP binding
  const onRouteChanged = () => {
    if (typeof window.__ag_topbar_nav__ === 'function') {
      try { window.__ag_topbar_nav__(); } catch {}
    }
  };

  const onWindowResize = () => {
    const tooltip = document.getElementById('ag-topbar-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  };

  window.__AG_TOPBAR_DETACH__ = () => {
    window.__AG_TOPBAR_ENABLED__ = false;
    window.__AG_TOPBAR_INITIALIZED__ = false;
    hasReceivedData = false;
    if (attachTimer) clearTimeout(attachTimer);
    if (window.__AG_TOPBAR_OBSERVER__) {
      try { window.__AG_TOPBAR_OBSERVER__.disconnect(); } catch {}
      window.__AG_TOPBAR_OBSERVER__ = null;
    }
    window.removeEventListener('popstate', onRouteChanged);
    window.removeEventListener('resize', onWindowResize);
    const badge = document.getElementById('ag-topbar-token-badge');
    if (badge) badge.remove();
    const tooltip = document.getElementById('ag-topbar-tooltip');
    if (tooltip) tooltip.remove();
    const styles = document.getElementById('ag-topbar-styles');
    if (styles) styles.remove();
  };

  // Watch for DOM mutations to re-attach if toolbar unmounts/remounts
  let attachTimer = null;
  const observer = new MutationObserver(() => {
    if (!window.__AG_TOPBAR_ENABLED__ || !hasReceivedData || !currentData.conversationId) return;
    if (!document.getElementById('ag-topbar-token-badge')) {
      if (attachTimer) clearTimeout(attachTimer);
      attachTimer = setTimeout(attachBadge, 100);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  window.__AG_TOPBAR_OBSERVER__ = observer;

  window.addEventListener('popstate', onRouteChanged);
  window.addEventListener('resize', onWindowResize);

  if (!window.__AG_TOPBAR_PUSH_HOOKED__) {
    window.__AG_TOPBAR_PUSH_HOOKED__ = true;
    const origPush = history.pushState;
    history.pushState = function(...args) {
      const ret = origPush.apply(this, args);
      onRouteChanged();
      return ret;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(...args) {
      const ret = origReplace.apply(this, args);
      onRouteChanged();
      return ret;
    };
  }
})();
`;
