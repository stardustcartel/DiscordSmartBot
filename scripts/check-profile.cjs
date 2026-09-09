const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function route(relativePath, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return vm.createContext({ structuredClone, Response, Uint8Array, atob, ...dependencies, source });
}

async function checkPartialUpdates() {
  let state = { settings: { profile: { nickname: 'Teddy', bio: 'Keep this bio', avatarKey: 'avatar.png', bannerKey: 'banner.png' }, personality: 'Keep this personality' } };
  let writes = 0;
  const uploads = [];
  const ctx = route('functions/api/guild/[guildId]/profile.js', {
    authorizedGuild: async () => true,
    json: (data, status = 200) => Response.json(data, { status }),
    mutateState: async (_db, _id, update) => { writes++; state = update(structuredClone(state)); },
  });
  vm.runInContext(ctx.source, ctx);
  const call = (body) => ctx.onRequestPut({ env: { DB: {}, BOT_ASSETS: { put: async (key) => uploads.push(key) } }, params: { guildId: 'test-server' }, request: { json: async () => body } });
  assert.equal((await call({ nickname: 'New name' })).status, 200);
  assert.deepEqual(structuredClone(state.settings.profile), { nickname: 'New name', bio: 'Keep this bio', avatarKey: 'avatar.png', bannerKey: 'banner.png' });
  assert.equal((await call({ bio: '' })).status, 200);
  assert.equal(state.settings.profile.nickname, 'New name');
  assert.equal(state.settings.profile.bio, '');
  assert.equal((await call({ avatarData: 'data:image/png;base64,AQ==' })).status, 200);
  assert.equal(state.settings.profile.bannerKey, 'banner.png');
  assert.equal(state.settings.profile.nickname, 'New name');
  assert.equal(state.settings.profile.bio, '');
  const avatarKey = state.settings.profile.avatarKey;
  assert.equal((await call({ bannerData: 'data:image/png;base64,AQ==' })).status, 200);
  assert.equal(state.settings.profile.avatarKey, avatarKey);
  assert.equal(state.settings.personality, 'Keep this personality');
  assert.equal(uploads.length, 2);
  assert.equal((await call({})).status, 400);
  assert.equal((await call({ bio: null })).status, 400);
  assert.equal(writes, 4);
}

async function checkImageUrls() {
  const ctx = route('functions/api/guild/[guildId]/settings.js', {
    authorizedGuild: async () => true,
    createStateIfMissing: async () => ({ settings: { profile: { avatarKey: 'old.png', bannerKey: 'banner.png' } }, updatedBy: 'dashboard', version: 12 }),
    json: (data) => Response.json(data),
    fetch: async (url) => Response.json(url.endsWith('/channels') ? [] : url.endsWith('/users/@me')
      ? { id: '123', avatar: 'global' }
      : { user: { id: '123' }, avatar: 'guild-avatar', banner: 'a_guild-banner' }),
  });
  vm.runInContext(ctx.source, ctx);
  const response = await ctx.onRequestGet({ env: { DISCORD_BOT_TOKEN: 'test' }, request: {}, params: { guildId: '456' } });
  const { settings: { profile } } = await response.json();
  assert.equal(profile.avatarUrls[0], '/api/guild/456/asset/avatar');
  assert.ok(profile.avatarUrls.includes('https://cdn.discordapp.com/guilds/456/users/123/avatars/guild-avatar.webp?size=256'));
  assert.ok(profile.bannerUrls.includes('https://cdn.discordapp.com/guilds/456/users/123/banners/a_guild-banner.webp?size=512&animated=true'));
}

function checkPreviewFallbacks() {
  const nodes = new Map();
  const images = [];
  const element = () => ({ textContent: '', innerHTML: '', style: {}, append(child) { this.child = child; } });
  const ctx = vm.createContext({ document: {
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    createElement() { const image = element(); images.push(image); return image; },
  } });
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/app.js'), 'utf8').split('function showWorkspace(')[0];
  vm.runInContext(source, ctx);
  ctx.renderProfilePreview({ avatarUrl: '/missing', avatarUrls: ['/missing', 'https://cdn.discordapp.com/avatar.webp?size=256'], bannerUrl: '/banner' }, 5);
  const avatar = nodes.get('#avatar-preview').child;
  avatar.onerror();
  assert.equal(avatar.src, 'https://cdn.discordapp.com/avatar.webp?size=256&v=5');
  avatar.onerror();
  assert.match(nodes.get('#avatar-preview').innerHTML, /aria-hidden/);
  const oldBanner = images[1];
  ctx.renderProfilePreview({ nickname: 'Other server' }, 6);
  oldBanner.onload();
  assert.equal(nodes.get('#banner-preview').style.backgroundImage, '');
  assert.equal(nodes.get('#preview-name').textContent, 'Other server');
}

async function checkSaveButtons() {
  const fields = ['nickname', 'bio', 'avatar', 'banner'];
  const forms = fields.map((field) => {
    const input = { value: `draft-${field}`, files: field === 'avatar' || field === 'banner' ? [{ name: `${field}.png`, size: 10 }] : [] };
    return { dataset: { profileField: field }, input, elements: { namedItem: () => input },
      setAttribute() {}, removeAttribute() {}, querySelector: () => ({ textContent: '' }) };
  });
  const buttons = fields.map(() => ({ disabled: false }));
  const requests = [];
  const ctx = vm.createContext({
    selected: 'guild-a', settings: {}, toast() {}, renderProfilePreview() {}, dataUrl: async () => 'data:image/png;base64,AQ==',
    document: { querySelectorAll: (selector) => selector.endsWith('> button') ? buttons : forms },
    api: async (url, options) => {
      requests.push({ url, body: options && JSON.parse(options.body) });
      return options ? { ok: true } : { settings: { profile: { nickname: 'saved nickname', bio: 'saved bio' } }, version: 1 };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/app.js'), 'utf8');
  const start = source.indexOf('document.querySelectorAll("[data-profile-field]").forEach((form) => {\n  form.onsubmit');
  const end = source.indexOf('$("#youtube-form").onsubmit', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), ctx);
  await forms[0].onsubmit({ preventDefault() {} });
  assert.deepEqual(requests[0].body, { nickname: 'draft-nickname' });
  assert.equal(forms[1].input.value, 'draft-bio');
  assert.equal(forms[2].input.files[0].name, 'avatar.png');
  await forms[2].onsubmit({ preventDefault() {} });
  assert.deepEqual(requests[2].body, { avatarData: 'data:image/png;base64,AQ==' });
  assert.equal(forms[1].input.value, 'draft-bio');
  assert.ok(buttons.every((button) => !button.disabled));
  assert.ok(requests.every((request) => request.url.startsWith('/api/guild/guild-a/')));
}

(async () => {
  await checkPartialUpdates();
  await checkImageUrls();
  checkPreviewFallbacks();
  await checkSaveButtons();
  console.log('Profile checks passed: independent updates preserve other fields; image URLs and fallback loading work.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
