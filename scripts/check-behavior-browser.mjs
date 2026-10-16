// Optional browser QA: npm install --no-save --package-lock=false playwright
// Uses installed Edge; all requests use local fixtures, not customer data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { defaults } from '../functions/_lib/db.js';
import { releases } from '../functions/_lib/releases.js';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'smartbot-behavior-qa-'));
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let settings = { ...defaults(), personality: 'Existing client personality. Do not migrate.', rules: 'Keep answers concise.', approvedAnswers: [] };
    let entries = structuredClone(releases), owner = true;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), p = url.pathname;
      const json = body => route.fulfill({ json: body });
      if (p === '/api/me') return json({ user: { username: 'Test admin' }, guilds: [{ id: '100000000000000001', name: 'Demo server' }] });
      if (p.endsWith('/settings')) return json({ settings, hasGeminiKey: true, hasOpenAiKey: true, channels: [], roles: [], version: 1 });
      if (p.endsWith('/openai-model')) return json({ models: ['gpt-6-luna'], reasoningEfforts: { 'gpt-6-luna': ['none', 'medium'] }, botDefaultReasoning: { 'gpt-6-luna': 'none' } });
      if (p.endsWith('/behavior')) { const body = route.request().postDataJSON(); settings = { ...settings, ...body }; return json({ ok: true, ...body }); }
      if (p === '/api/releases') {
        if (route.request().method() === 'DELETE') { entries = entries.filter(r => r.version !== route.request().postDataJSON().version); return json({ ok: true }); }
        return json({ releases: entries, canDelete: owner });
      }
      if (p.startsWith('/api/')) return json({});
      const file = path.resolve('dashboard', p === '/' ? 'index.html' : p.slice(1));
      if (!file.startsWith(path.resolve('dashboard') + path.sep)) return route.abort();
      try { await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('https://smartbot.test');
    await page.locator('[data-guild="100000000000000001"]').click();
    await page.locator('#gemini-tab').click();
    await page.locator('#personality-tab').click();
    await page.locator('#personality.active').waitFor();
    assert.equal(await page.locator('#personality-form textarea').inputValue(), settings.personality);
    assert.equal(await page.locator('#personality-form button').isDisabled(), true);
    assert.equal(await page.locator('#rules-form button').isDisabled(), true);
    assert.equal(await page.locator('#associations-form button[type=submit]').isDisabled(),true);
    await page.locator('#add-association').click();
    assert.equal(await page.locator('#associations-form button[type=submit]').isDisabled(),true);
    await page.locator('#association-list input').nth(0).fill('Example creator');
    await page.locator('#association-list textarea').nth(0).fill('EC, Example');
    await page.locator('#association-list input').nth(1).fill('not-an-id');
    assert.equal(await page.locator('#associations-form button[type=submit]').isDisabled(),true);
    await page.locator('#association-list input').nth(1).fill('100000000000000004');
    await page.locator('#associations-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#associations-form button[type=submit]').disabled);
    assert.deepEqual(settings.searchAssociations[0].aliases,['EC','Example']);
    await page.locator('#rules-form textarea').fill('');
    assert.equal(await page.locator('#rules-form button').isEnabled(), true, 'Clearing rules must be possible');
    await page.locator('#rules-form button').click();
    await page.waitForFunction(() => document.querySelector('#rules-form button').disabled);
    await page.locator('#add-approved-answer').click();
    assert.equal(await page.locator('#approved-answers-form button[type=submit]').isDisabled(), true);
    await page.locator('#approved-answer-list input').first().fill('Where are our resources?');
    await page.locator('#approved-answer-list textarea').fill('Use the official library in Patreon Collections.');
    await page.locator('#approved-answers-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#approved-answers-form button[type=submit]').disabled);
    await page.screenshot({ path: path.join(output, `behavior-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
    await page.locator('#help-tab').click();
    await page.locator('#version-history-tab').click();
    await page.locator('.release-entry').first().waitFor();
    assert.equal(await page.locator('.release-major').first().textContent(), '2.0');
    await page.screenshot({ path: path.join(output, `releases-${width}.png`), fullPage: true });
    const before = await page.locator('.release-entry').count();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.release-remove').first().click();
    assert.equal(await page.locator('.release-entry').count(), before);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.release-remove').first().click();
    await page.waitForFunction(n => document.querySelectorAll('.release-entry').length === n, before - 1);
    owner = false;
    await page.locator('#version-history-tab').click();
    await page.waitForFunction(() => document.querySelectorAll('.release-entry').length > 0 && document.querySelectorAll('.release-remove').length === 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Desktop/mobile Behavior save states, release permissions/confirmation, and overflow checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
