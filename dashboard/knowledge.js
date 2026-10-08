let knowledgeChannels = [];
let knowledgeSelections = new Set();
let knowledgeDirty = false;
function closeKnowledgeMenu() {
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
    renderKnowledgeChannels();
  }; });
  if (focusedId) list.querySelector(`[data-knowledge-id="${focusedId}"]`)?.focus();
}
async function loadKnowledge(reset = false) {
  const guildId = selected;
  if (!guildId) return;
  const data = await api(`/api/guild/${guildId}/knowledge`);
  if (guildId !== selected) return;
  if (reset || !knowledgeDirty) {
    knowledgeSelections = new Set(data.channelIds);
    knowledgeChannels = data.channels;
    for (const id of data.channelIds) if (!knowledgeChannels.some((c) => c.id === id)) knowledgeChannels.push({ id, name: "Restricted or unavailable channel" });
    renderKnowledgeChannels();
    knowledgeDirty = false;
  }
  const status = data.status;
  const stale = !status || Date.now() - Number(data.reportedAt) > 120000;
  const pending = status && JSON.stringify([...(status.channelIds || [])].sort()) !== JSON.stringify([...data.channelIds].sort());
  $("#knowledge-status-title").textContent = stale ? "Waiting for the bot to report" : pending ? "Waiting for channel changes to sync" : status.state === "disabled" ? "No knowledge channels selected" : status.state === "ready" ? "Knowledge base is ready" : status.state === "partial" ? "Some sources need attention" : "Indexing in the background";
  $("#knowledge-status-details").textContent = (status ? `${Number(status.indexed || 0).toLocaleString()} messages cataloged · ${Number(status.embedded || 0).toLocaleString()} ready for semantic search · ${Number(status.pendingChannels || 0)} channels or posts still backfilling` : "Choose your source channels, then save to start cataloging their messages and forum posts.") + (stale || pending || status?.state === "indexing" || status?.state === "retrying" ? " The bot reports about every 30 seconds; this page checks for updates every 15 seconds." : "");
  $("#knowledge-status-time").textContent = status?.updatedAt ? `Last checked: ${new Date(status.updatedAt).toLocaleString()}` : "";
  $("#knowledge-warnings").replaceChildren(...(status?.warnings || []).map((text) => { const p = document.createElement("p"); p.textContent = text; return p; }));
}
function setupKnowledge() {
  $("#knowledge-trigger").onclick = () => {
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
    try {
      const result = await api(`/api/guild/${guildId}/knowledge`, { method: "PUT", body: JSON.stringify({ channelIds: [...knowledgeSelections] }) });
      if (guildId === selected) { knowledgeDirty = false; closeKnowledgeMenu(); await loadKnowledge(true); toast(result.message); }
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  };
  document.addEventListener("click", (event) => { if (!event.target.closest("#knowledge-select")) closeKnowledgeMenu(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeKnowledgeMenu();
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
