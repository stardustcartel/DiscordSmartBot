let patreonGuild = '', patreonSaved = [], patreonSelected = new Set(), patreonDirty = false, patreonBusy = false, patreonLoadId = 0;
function closePatreonMenu() {
  $('#patreon-channel-options').hidden = true;
  $('#patreon-channel-trigger').setAttribute('aria-expanded', 'false');
  $('#patreon-channel-trigger').classList.remove('open');
}
function renderPatreonChannels() {
  const list = $('#patreon-channel-options');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  $('#patreon-channel-label').textContent = patreonSelected.size ? `${patreonSelected.size} channels selected` : 'All bot response channels';
  const choices = [...knowledgeChannels];
  for (const id of patreonSelected) if (!choices.some(c => c.id === id)) choices.push({ id, name: 'Unavailable channel' });
  list.replaceChildren(...choices.map(channel => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'select-option multi-select-option'; button.dataset.id = channel.id; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(patreonSelected.has(channel.id)));
    const check = document.createElement('span'); check.className = 'multi-select-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = `# ${channel.name}${channel.type === 15 ? ' · Forum' : ''}`;
    button.append(check, label);
    button.onclick = event => { event.stopPropagation(); if (patreonBusy || patreonGuild !== selected) return; if (patreonSelected.has(channel.id)) patreonSelected.delete(channel.id); else patreonSelected.add(channel.id); patreonDirty = true; renderPatreonChannels(); };
    return button;
  }));
  if (focused) [...list.children].find(b => b.dataset.id === focused)?.focus();
  $('#patreon-visibility-save').disabled = patreonBusy || patreonGuild !== selected || JSON.stringify([...patreonSelected].sort()) === JSON.stringify([...patreonSaved].sort());
}
async function loadPatreon() {
  const guildId = selected;
  if (!guildId) return;
  const loadId = ++patreonLoadId;
  const data = await api(`/api/guild/${guildId}/patreon`);
  if (guildId !== selected || loadId !== patreonLoadId) return;
  if (patreonGuild !== guildId) { patreonDirty = false; closePatreonMenu(); }
  patreonGuild = guildId; patreonSaved = data.channelIds || [];
  if (!patreonDirty) patreonSelected = new Set(patreonSaved);
  $('#patreon-connect').hidden = data.connected;
  $('#patreon-connect').disabled = !data.configured || patreonBusy;
  $('#patreon-connected').hidden = !data.connected;
  $('#patreon-name').textContent = data.name || '';
  $('#patreon-setup-note').hidden = data.configured;
  $('#patreon-sync').disabled = patreonBusy;
  $('#patreon-reconnect').disabled = patreonBusy || !data.configured;
  $('#patreon-disconnect').disabled = patreonBusy;
  renderPatreonChannels();
  const status = data.status, stale = !status || Date.now() - data.reportedAt > 120000;
  $('#patreon-status-title').textContent = !data.connected ? 'Patreon is not connected' : stale ? 'Patreon: waiting for the bot to report' : status.state === 'ready' ? 'Patreon Knowledge base is ready' : ['error', 'partial'].includes(status.state) ? 'Patreon knowledge base needs attention' : 'Patreon indexing in the background';
  $('#patreon-status-details').textContent = data.connected ? (status ? `${Number(status.indexed || 0).toLocaleString()} posts cataloged · ${Number(status.embedded || 0).toLocaleString()} of ${Number(status.chunks || 0).toLocaleString()} text sections ready for semantic search · ${status.backfilling ? 'Historical import in progress' : 'No historical import pending'}. ` : 'Your posts will begin importing shortly. ') + 'The bot reports about every 30 seconds; this page checks for updates every 15 seconds.' : 'Connect the creator’s Patreon account to add its posts to your bot’s knowledge.';
  $('#patreon-status-time').textContent = status?.lastChecked ? `Last checked: ${new Date(status.lastChecked).toLocaleString()}` : '';
  $('#patreon-warning').textContent = status?.warning || (data.connected && !data.webhook ? 'Automatic post notifications are unavailable. Periodic synchronization remains active.' : '');
}
async function patreonAction(action, extra = {}) {
  const guildId = selected;
  if (!guildId || patreonBusy || patreonGuild !== guildId) return;
  patreonBusy = true;
  $('#patreon-card').setAttribute('aria-busy', 'true');
  for (const id of ['patreon-connect','patreon-reconnect','patreon-sync','patreon-disconnect','patreon-visibility-save','patreon-channel-trigger']) $('#' + id).disabled = true;
  try {
    const result = await api(`/api/guild/${guildId}/patreon`, { method: 'POST', body: JSON.stringify({ action, ...extra }) });
    if (guildId !== selected) return;
    if (action === 'connect') { location.assign(result.url); return; }
    if (action === 'visibility') { patreonDirty = false; closePatreonMenu(); }
    toast(action === 'disconnect' ? 'Patreon disconnected. Imported posts will be removed.' : action === 'sync' ? 'Patreon sync requested. The bot will pick it up shortly.' : 'Patreon visibility saved.');
  } catch (error) { toast(error.message); }
  finally { patreonBusy = false; $('#patreon-channel-trigger').disabled = false; $('#patreon-card').removeAttribute('aria-busy'); await loadPatreon().catch(() => {}); }
}
function setupPatreon() {
  $('#patreon-connect').onclick = () => patreonAction('connect');
  $('#patreon-reconnect').onclick = () => patreonAction('connect');
  $('#patreon-sync').onclick = () => patreonAction('sync');
  $('#patreon-disconnect').onclick = () => { if (confirm('Disconnect Patreon and remove its imported posts from this server’s knowledge base?')) patreonAction('disconnect'); };
  $('#patreon-visibility-form').onsubmit = event => { event.preventDefault(); patreonAction('visibility', { channelIds: [...patreonSelected] }); };
  $('#patreon-channel-trigger').onclick = () => { const open = $('#patreon-channel-options').hidden; closePatreonMenu(); $('#patreon-channel-options').hidden = !open; $('#patreon-channel-trigger').setAttribute('aria-expanded', String(open)); $('#patreon-channel-trigger').classList.toggle('open', open); };
  document.addEventListener('click', event => { if (!event.target.closest('#patreon-channel-select')) closePatreonMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePatreonMenu();
    if (!$('#patreon-channel-options').hidden && event.target.closest('#patreon-channel-select') && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...$('#patreon-channel-options').children], index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  });
}
