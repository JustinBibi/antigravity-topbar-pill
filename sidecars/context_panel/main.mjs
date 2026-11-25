import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { buildConversationUsage } from './tracker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'index.html');

const app = new SidecarApp();

app.page('/', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  return new Response(html, {
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' }
  });
});

app.api('/api/usage', (data) => {
  const conversationId = data.conversationId || app.config.conversationId || '';
  const clientEtag = data.etag || '';
  return buildConversationUsage({ conversationId, clientEtag });
}, 'POST');

app.run();
