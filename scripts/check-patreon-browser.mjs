// Synthetic browser QA; no live customer data or tokens.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { defaults } from '../functions/_lib/db.js';
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'smartbot-patreon-qa-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const guildId = '100000000000000001';
    const channels = [{ id: '100000000000000004', name: 'general', type: 0 }, { id: '100000000000000005', name: 'member-forum', type: 15 }];
    let connected = true, configured = true, saved = [];
    await page.route('https://smartbot.test/**', async route => {
      const url = new URL(route.request().url()), p = url.pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (p === '/api/me') return json({ user: { username: 'Admin' }, guilds: [{ id: guildId, name: 'Test server' }] });
      if (p.endsWith('/settings')) return json({ settings: defaults(), hasGeminiKey: true, channels, roles: [], version: 1 });
      if (p.endsWith('/openai-model')) return json({ models: ['gpt-6-luna'], reasoningEfforts: { 'gpt-6-luna': ['none','medium'] }, botDefaultReasoning: { 'gpt-6-luna': 'none' } });
      if (p.endsWith('/knowledge')) return json({ channels, channelIds: [], policy: {}, status: { state: 'ready', indexed: 28696, embedded: 28696, channelIds: [], updatedAt: Date.now() }, reportedAt: Date.now() });
      if (p.endsWith('/patreon')) {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          if (body.action === 'visibility') saved = body.channelIds;
          if (body.action === 'disconnect') connected = false;
          return json({ ok: true });
        }
        return json({ configured, connected, name: 'Creator library', channelIds: saved, webhook: true, reportedAt: Date.now(), status: { state: 'ready', indexed: 120, chunks: 150, embedded: 150, lastChecked: Date.now() } });
      }
      if (p.startsWith('/api/')) return json({});
      const file = path.resolve('dashboard', p === '/' || p === '/dashboard' ? 'index.html' : p.slice(1));
      if (!file.startsWith(path.resolve('dashboard')+path.sep)) return route.abort();
      try { await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('https://smartbot.test/dashboard?patreon=connected&guild='+guildId);
    await page.locator('#knowledge.active').waitFor();
    await page.waitForFunction(() => document.querySelector('#patreon-status-title').textContent === 'Patreon Knowledge base is ready');
    assert.equal(await page.locator('#knowledge-status-title').textContent(), 'Discord knowledge base is ready');
    assert.equal(await page.locator('#patreon-visibility-save').isDisabled(), true);
    await page.locator('#patreon-channel-trigger').click();
    await page.locator('#patreon-channel-options button').first().click();
    assert.equal(await page.locator('#patreon-channel-options').isVisible(), true);
    await page.locator('#patreon-channel-options button').last().click();
    assert.equal(await page.locator('#patreon-channel-options [aria-selected=true]').count(), 2);
    await page.evaluate(() => loadPatreon());
    assert.equal(await page.locator('#patreon-channel-options [aria-selected=true]').count(), 2, 'Polling preserves unsaved choices');
    const menu = await page.locator('#patreon-channel-options').boundingBox(), card = await page.locator('#patreon-card').boundingBox();
    assert.ok(menu.y+menu.height <= card.y+card.height, 'Menu expands inside card');
    await page.screenshot({ path: path.join(output, `patreon-${width}.png`), fullPage: true });
    await page.locator('#patreon-visibility-save').click();
    await page.waitForFunction(() => document.querySelector('#patreon-visibility-save').disabled);
    assert.equal(saved.length, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#patreon-disconnect').click();
    await page.locator('#patreon-connect').waitFor({ state: 'visible' });
    configured = false; await page.evaluate(() => loadPatreon());
    assert.equal(await page.locator('#patreon-connect').isDisabled(), true);
    assert.equal(await page.locator('#patreon-setup-note').isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Patreon desktop/mobile, OAuth return, separate status, multi-select, polling, disabled saves, disconnect and pending setup passed. Screenshots: '+output);
} finally { await browser.close(); }
