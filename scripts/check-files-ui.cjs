// Run with a Playwright package path and optional browser executable path.
// Uses synthetic API fixtures only; never connects to a real server account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '../dashboard');
const fixture = { configured: true, googleConfigured: true, channelIds: [], google: { connected: true, name: 'Test Creator', email: 'creator@example.test', folders: [], sync: {} }, status: { ready: 1 }, files: [{ id: 'sample', name: 'Example.txt', description: 'Example context', kind: 'upload', state: 'ready', size: 64, sha256: 'fixture', revision: '1', createdAt: Date.now(), objectKey: 'fixture/sample', status: { sections: 1, semanticReady: 1 } }] };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    const data = pathname === '/api/me' ? { user: null } : pathname.endsWith('/knowledge') ? { channels: [{ id: '1', name: 'Forum', type: 15 }, { id: '2', name: 'General', type: 0 }] } : req.method === 'POST' ? { folders: [{ id: 'folder', name: 'Example folder' }] } : fixture;
    return res.end(JSON.stringify(data));
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => { selected='fixture'; showWorkspace(); showTab('gemini'); });
    assert.equal(await page.locator('#knowledge-tab').isDisabled(), true);
    assert.match(await page.locator('#knowledge-tab').innerText(), /Add an AI key first/);
    await page.evaluate(() => showTab('files'));
    assert.equal(await page.locator('#files').isVisible(), false);
    await page.locator('#gemini-tab').click();
    assert.equal(await page.locator('#knowledge-tab').isVisible(), false);
    await page.locator('#gemini-tab').click();
    assert.equal(await page.locator('#knowledge-tab').isVisible(), true);
    await page.evaluate(async () => { setKnowledgeLock(false); showTab('files'); await loadFiles(); });
    await page.waitForFunction(() => document.querySelector('#file-google-name').textContent.includes('creator@example.test'));
    assert.equal(await page.locator('#files .file-feature-card').count(), 1);
    assert.equal(await page.locator('#file-list').locator('..').locator('#file-channel-save').count(), 1);
    await page.locator('#file-channel-trigger').click();
    await page.locator('#file-channel-options button').first().click();
    assert.equal(await page.locator('#file-channel-options').isVisible(), true);
    await page.locator('#file-channel-options button').last().click();
    await page.locator('#file-channel-trigger').click();
    assert.equal(await page.locator('#file-channel-options').isVisible(), false);
    await page.locator('#file-upload-input').setInputFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('Fixture only') });
    assert.equal(await page.locator('#file-upload-save').isDisabled(), false);
    await page.locator('#file-upload-clear').click();
    assert.equal(await page.locator('#file-upload-input').evaluate(el => el.files.length), 0);
    assert.equal(await page.locator('#file-upload-save').isDisabled(), true);
    assert.equal(await page.locator('#file-upload-save').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    assert.equal(await page.getByRole('button', { name: 'Save description' }).evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    assert.equal(await page.locator('#file-upload-clear').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Delete document', exact: true }).isVisible(), false);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Delete document', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    for (const selector of ['#file-google-sync', '#file-google-reconnect', '#file-google-disconnect', '#file-folder-add']) {
      assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
    }
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'smartbot-files-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page must not overflow');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'smartbot-files-mobile.png'), fullPage: true });
    fixture.google.connected = false;
    await page.evaluate(() => loadFiles());
    assert.equal(await page.locator('#file-google-connect img').evaluate(el => el.complete && el.naturalWidth > 0), true);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: AI locks/collapse, merged card, multiselect, clear files, confirmations, buttons, Google identity/logo and mobile layout.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode=1; });
