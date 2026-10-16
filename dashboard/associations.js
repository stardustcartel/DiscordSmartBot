let associationDrafts = [];
const associationValues = () => associationDrafts.map(({ id, name, aliases, related, userId, context }) => ({ id, name: name.trim(), aliases: [...new Set(aliases.split(/[,\n]/).map(s => s.trim()).filter(Boolean))], related: [...new Set(related.split(/[,\n]/).map(s => s.trim()).filter(Boolean))], userId: userId.trim(), context: context.trim() }));
function updateAssociationSaveButton() {
  const form = document.getElementById('associations-form');
  if (!form) return;
  const values = associationValues();
  const valid = values.length <= 40 && values.every(x => x.name && x.name.length <= 120 && (!x.userId || /^\d{15,25}$/.test(x.userId)) && x.context.length <= 500 && [x.aliases,x.related].every(xs => xs.length <= 20 && xs.every(s => s.length <= 120))) && values.reduce((n,x) => n + JSON.stringify(x).length,0) <= 12000;
  const ready = selected && settingsLoadedGuild === selected && form.getAttribute('aria-busy') !== 'true';
  form.querySelector('[type=submit]').disabled = !ready || !valid || JSON.stringify(values) === JSON.stringify(settings.searchAssociations || []);
  document.getElementById('add-association').disabled = !ready || values.length >= 40;
}
function renderAssociations() {
  const container = document.getElementById('association-list'); container.replaceChildren();
  for (const item of associationDrafts) {
    const card = document.createElement('fieldset'); card.className = 'approved-answer-card';
    const legend = document.createElement('legend'); legend.textContent = `Association ${associationDrafts.indexOf(item) + 1}`; card.append(legend);
    for (const [key, title, max, placeholder] of [
      ['name','Person, community, or topic',120,'A name used in your server'],
      ['aliases','Other names for the same thing',2500,'Separate names with commas or new lines'],
      ['userId','Discord user ID (optional)',25,'Links a person to messages they authored'],
      ['related','Related search terms',2500,'Related ideas, not necessarily interchangeable names'],
      ['context','When this association applies (optional)',500,'Explain the context or any ambiguity']
    ]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement(['aliases','related','context'].includes(key) ? 'textarea' : 'input'); input.value = item[key]; input.maxLength = max; input.placeholder = placeholder;
      if (key === 'name') input.required = true;
      if (key === 'userId') { input.inputMode = 'numeric'; input.pattern = '[0-9]{15,25}'; }
      input.oninput = () => { item[key] = input.value; updateAssociationSaveButton(); };
      label.append(input); card.append(label);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'behavior-remove'; remove.textContent = 'Remove association';
    remove.onclick = () => { associationDrafts = associationDrafts.filter(x => x.id !== item.id); renderAssociations(); updateAssociationSaveButton(); };
    card.append(remove); container.append(card);
  }
}
function loadAssociations() {
  associationDrafts = (settings.searchAssociations || []).map(x => ({ ...x, aliases: x.aliases.join('\n'), related: x.related.join('\n') }));
  renderAssociations(); updateAssociationSaveButton();
}
function setupAssociations() {
  document.getElementById('add-association').onclick = () => {
    if (associationDrafts.length >= 40) return;
    associationDrafts.push({ id: crypto.randomUUID(), name: '', aliases: '', related: '', userId: '', context: '' }); renderAssociations(); updateAssociationSaveButton();
    document.querySelector('#association-list fieldset:last-child input')?.focus();
  };
  const form = document.getElementById('associations-form');
  form.onsubmit = async event => {
    event.preventDefault(); if (!selected || form.getAttribute('aria-busy') === 'true') return;
    const guildId = selected, value = associationValues();
    form.setAttribute('aria-busy','true'); form.inert = true; updateAssociationSaveButton();
    try {
      const result = await api(`/api/guild/${guildId}/behavior`, { method:'PUT', body:JSON.stringify({ searchAssociations:value }) });
      if (selected !== guildId) return;
      settings.searchAssociations = result.searchAssociations; loadAssociations(); toast('Names & search associations saved.');
    } catch (error) { toast(error.message); }
    finally { form.removeAttribute('aria-busy'); form.inert = false; updateAssociationSaveButton(); }
  };
}
