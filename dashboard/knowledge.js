let knowledgeChannels = [];
let knowledgeSelections = new Set();
let knowledgeDirty = false;
let knowledgeSourceRevision = 0;
let knowledgeLoadSerial = 0;
let knowledgePolicyDirty = false;
let knowledgePolicyGuild = null;
let knowledgePolicyRevision = 0;
let knowledgePolicy = { knowledgeOnly: false, requireCitations: false, citationCount: 3, generalChannels: [], uncitedChannels: [] };
const knowledgePolicyKinds = ["count", "general", "uncited"];
function closeKnowledgePolicyMenus() {
  for (const kind of knowledgePolicyKinds) {
    $(`#knowledge-${kind}-options`).hidden = true;
    $(`#knowledge-${kind}-trigger`).setAttribute("aria-expanded", "false");
    $(`#knowledge-${kind}-trigger`).classList.remove("open");
  }
}
function renderKnowledgePolicy() {
  $("#knowledge-only").checked = knowledgePolicy.knowledgeOnly;
  $("#knowledge-citations").checked = knowledgePolicy.requireCitations;
  $("#knowledge-count-field").hidden = !knowledgePolicy.requireCitations;
  $("#knowledge-general-field").hidden = !knowledgePolicy.knowledgeOnly;
  $("#knowledge-uncited-field").hidden = !knowledgePolicy.requireCitations;
  for (const kind of knowledgePolicyKinds) {
    const list = $(`#knowledge-${kind}-options`);
    const focusValue = list.contains(document.activeElement) ? document.activeElement.dataset.value : null;
    const key = kind === "general" ? "generalChannels" : "uncitedChannels";
    const choices = kind === "count" ? [1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: String(n) })) : [...knowledgeChannels];
    if (kind !== "count") for (const id of knowledgePolicy[key]) if (!choices.some((c) => c.id === id)) choices.push({ id, name: "Restricted or unavailable channel" });
    $(`#knowledge-${kind}-label`).textContent = kind === "count" ? String(knowledgePolicy.citationCount) : knowledgePolicy[key].length ? `${knowledgePolicy[key].length} channel${knowledgePolicy[key].length === 1 ? "" : "s"} selected` : "No exceptions";
    list.replaceChildren(...choices.map((choice) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "select-option" + (kind === "count" ? "" : " multi-select-option");
      button.setAttribute("role", "option"); button.dataset.value = choice.id;
      button.setAttribute("aria-selected", String(kind === "count" ? knowledgePolicy.citationCount === Number(choice.id) : knowledgePolicy[key].includes(choice.id)));
      if (kind !== "count") { const check = document.createElement("span"); check.className = "multi-select-check"; check.textContent = "✓"; check.setAttribute("aria-hidden", "true"); button.append(check); }
      const label = document.createElement("span"); label.textContent = kind === "count" ? choice.name : `# ${choice.name}${choice.type === 15 ? " · Forum" : choice.type === 5 ? " · Announcement" : ""}`; button.append(label);
      button.onclick = (event) => {
        event.stopPropagation();
        if (kind === "count") knowledgePolicy.citationCount = Number(choice.id);
        else knowledgePolicy[key] = knowledgePolicy[key].includes(choice.id) ? knowledgePolicy[key].filter((id) => id !== choice.id) : [...knowledgePolicy[key], choice.id];
        knowledgePolicyDirty = true; knowledgePolicyRevision++; renderKnowledgePolicy();
        if (kind === "count") { closeKnowledgePolicyMenus(); $("#knowledge-count-trigger").focus(); }
      };
      return button;
    }));
    if (focusValue) [...list.querySelectorAll("button")].find((b) => b.dataset.value === focusValue)?.focus();
  }
}
function closeKnowledgeMenu() {
  closeKnowledgePolicyMenus();
  $("#knowledge-options").hidden = true;
  $("#knowledge-trigger").setAttribute("aria-expanded", "false");
  $("#knowledge-trigger").classList.remove("open");
}
function renderKnowledgeChannels() {
  $("#knowledge-label").textContent = knowledgeSelections.size ? `${knowledgeSelections.size} channel${knowledgeSelections.size === 1 ? "" : "s"} selected` : "Select channels and forums";
  const list = $("#knowledge-options");
  const focusedId = document.activeElement?.dataset.knowledgeId;
  list.innerHTML = knowledgeChannels.map((c) => `<button type="button" class="select-option multi-select-option" role="option" aria-selected="${knowledgeSelections.has(c.id)}" data-knowledge-id="${esc(c.id)}"><span class="multi-select-check" aria-hidden="true">✓</span><span># ${esc(c.name)}${c.type === 15 ? " · Forum" : c.type === 5 ? " · Announcement" : ""}</span></button>`).join("") || '<p class="hint">No readable channels available.</p>';
  list.querySelectorAll("button").forEach((button) => { button.onclick = (event) => {
    event.stopPropagation();
    const id = button.dataset.knowledgeId;
    knowledgeSelections.has(id) ? knowledgeSelections.delete(id) : knowledgeSelections.add(id);
    knowledgeDirty = true;
    knowledgeSourceRevision++;
    renderKnowledgeChannels();
  }; });
  if (focusedId) list.querySelector(`[data-knowledge-id="${focusedId}"]`)?.focus();
}
async function loadKnowledge(reset = false) {
  const guildId = selected;
  if (!guildId) return;
  const serial = ++knowledgeLoadSerial;
  const data = await api(`/api/guild/${guildId}/knowledge`);
  if (guildId !== selected || serial !== knowledgeLoadSerial) return;
  $("#knowledge-form").inert = false;
  $("#knowledge-policy-form").inert = false;
  const guildChanged = knowledgePolicyGuild !== guildId;
  if (guildChanged || !knowledgePolicyDirty) {
    knowledgePolicy = { knowledgeOnly: false, requireCitations: false, citationCount: 3, generalChannels: [], uncitedChannels: [], ...data.policy };
    knowledgePolicyDirty = false;
    knowledgePolicyGuild = guildId;
  }
  if (reset || !knowledgeDirty) {
    knowledgeSelections = new Set(data.channelIds);
    knowledgeChannels = data.channels;
    for (const id of data.channelIds) if (!knowledgeChannels.some((c) => c.id === id)) knowledgeChannels.push({ id, name: "Restricted or unavailable channel" });
    renderKnowledgeChannels();
    knowledgeDirty = false;
  }
  renderKnowledgePolicy();
  const status = data.status;
  const stale = !status || Date.now() - Number(data.reportedAt) > 120000;
  const pending = status && JSON.stringify([...(status.channelIds || [])].sort()) !== JSON.stringify([...data.channelIds].sort());
  $("#knowledge-status-title").textContent = stale ? "Waiting for the bot to report" : pending ? "Waiting for channel changes to sync" : status.state === "disabled" ? "No knowledge channels selected" : status.state === "ready" ? "Knowledge base is ready" : status.state === "partial" ? "Some sources need attention" : "Indexing in the background";
  $("#knowledge-status-details").textContent = (status ? `${Number(status.indexed || 0).toLocaleString()} messages cataloged · ${Number(status.embedded || 0).toLocaleString()} ready for semantic search · ${Number(status.pendingChannels || 0)} channels or posts still backfilling` : "Choose your source channels, then save to start cataloging their messages and forum posts.") + (stale || pending || status?.state === "indexing" || status?.state === "retrying" ? " The bot reports about every 30 seconds; this page checks for updates every 15 seconds." : "");
  $("#knowledge-status-time").textContent = status?.updatedAt ? `Last checked: ${new Date(status.updatedAt).toLocaleString()}` : "";
  $("#knowledge-warnings").replaceChildren(...(status?.warnings || []).map((text) => { const p = document.createElement("p"); p.textContent = text; return p; }));
}
function setupKnowledge() {
  for (const [id, key] of [["#knowledge-only", "knowledgeOnly"], ["#knowledge-citations", "requireCitations"]]) $(id).onchange = (event) => {
    knowledgePolicy[key] = event.target.checked; knowledgePolicyDirty = true; knowledgePolicyRevision++; closeKnowledgePolicyMenus(); renderKnowledgePolicy();
  };
  for (const kind of knowledgePolicyKinds) $(`#knowledge-${kind}-trigger`).onclick = () => {
    const list = $(`#knowledge-${kind}-options`), trigger = $(`#knowledge-${kind}-trigger`);
    const opening = list.hidden;
    closeKnowledgeMenu();
    list.hidden = !opening; trigger.classList.toggle("open", opening); trigger.setAttribute("aria-expanded", String(opening));
    if (opening) (list.querySelector('[aria-selected="true"]') || list.querySelector("button"))?.focus();
  };
  $("#knowledge-policy-form").onsubmit = async (event) => {
    event.preventDefault();
    const guildId = selected, revision = knowledgePolicyRevision;
    const button = event.target.querySelector("button[type=submit]"); button.disabled = true;
    try {
      const result = await api(`/api/guild/${guildId}/knowledge`, { method: "PUT", body: JSON.stringify({ policy: knowledgePolicy }) });
      if (guildId === selected) {
        if (revision === knowledgePolicyRevision) knowledgePolicyDirty = false;
        closeKnowledgePolicyMenus(); await loadKnowledge(); toast(result.message);
      }
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  };
  $("#knowledge-trigger").onclick = () => {
    closeKnowledgePolicyMenus();
    const opening = $("#knowledge-options").hidden;
    $("#knowledge-options").hidden = !opening;
    $("#knowledge-trigger").classList.toggle("open", opening);
    $("#knowledge-trigger").setAttribute("aria-expanded", String(opening));
    if (opening) $("#knowledge-options button")?.focus();
  };
  $("#knowledge-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    const guildId = selected;
    const revision = knowledgeSourceRevision;
    try {
      const result = await api(`/api/guild/${guildId}/knowledge`, { method: "PUT", body: JSON.stringify({ channelIds: [...knowledgeSelections] }) });
      if (guildId === selected) { if (revision === knowledgeSourceRevision) knowledgeDirty = false; closeKnowledgeMenu(); await loadKnowledge(); toast(result.message); }
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#knowledge-select, .knowledge-policy-select")) closeKnowledgeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeKnowledgeMenu();
    const policySelect = event.target.closest(".knowledge-policy-select");
    if (policySelect && !policySelect.querySelector(".select-menu").hidden && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...policySelect.querySelectorAll(".select-menu button")], index = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
    if (!$("#knowledge-options").hidden && event.target.closest("#knowledge-select") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...$("#knowledge-options").querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  setInterval(() => { if (!document.hidden && $("#knowledge").classList.contains("active") && !$("#workspace").hidden) loadKnowledge().catch(() => {}); }, 15000);
}
