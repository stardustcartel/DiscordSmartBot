const $ = (selector) => document.querySelector(selector);
let selected = "";
let settings = {};
let inviteUrl = "/auth/invite";
let dashboardReady = false;
let permissionMemberId = "";
let permissionRoleId = "";
let permissionSearchTimer;
const defaultAnnouncementTemplate = "📺 **{channel} uploaded a new video:**\n**{title}**";
const announcementModalState = { subscription: null, initialValue: "", trigger: null, closeTimer: null };

$("#profile .eyebrow").textContent = "CUSTOMIZE BOT";

const esc = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const toast = (message) => { const element = $("#toast"); element.textContent = message; element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 4200); };
const api = (url, options = {}) => fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...options }).then(async (response) => {
  if (!(response.headers.get("content-type") || "").includes("application/json")) { const error = Error("Dashboard service unavailable"); error.code = "DASHBOARD_API_UNAVAILABLE"; throw error; }
  const data = await response.json(); if (!response.ok) throw Error(data.error || "Something went wrong"); return data;
});
const dataUrl = (file) => new Promise((resolve, reject) => { if (!file) return resolve(""); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
const subscriptionKey = (subscription) => `${subscription.youtubeChannelId}:${subscription.destinationChannelId}`;

function openAnnouncementModal(subscription, trigger) {
  const modal = $("#announcement-modal");
  clearTimeout(announcementModalState.closeTimer);
  announcementModalState.subscription = subscription;
  announcementModalState.initialValue = subscription.announcementTemplate || defaultAnnouncementTemplate;
  announcementModalState.trigger = trigger;
  $("#announcement-modal-channel").textContent = subscription.sourceName || "YouTube channel";
  $("#announcement-editor").value = announcementModalState.initialValue;
  $("#announcement-save").hidden = true;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    modal.classList.add("open");
    $("#announcement-editor").focus();
  });
}

function closeAnnouncementModal() {
  const modal = $("#announcement-modal");
  if (modal.hidden) return;
  modal.classList.remove("open");
  document.body.classList.remove("modal-open");
  const trigger = announcementModalState.trigger;
  announcementModalState.closeTimer = setTimeout(() => {
    modal.hidden = true;
    announcementModalState.subscription = null;
    announcementModalState.trigger = null;
    trigger?.focus();
  }, 200);
}

let updateMobileNavHint = () => {};
function setupMobileNavigationHint() {
  const nav = $(".sidebar nav");
  if (!nav || nav.closest(".mobile-nav-shell")) return;
  const shell = document.createElement("div");
  shell.className = "mobile-nav-shell";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "mobile-nav-more";
  more.setAttribute("aria-label", "Show more navigation options");
  more.textContent = "›";
  nav.before(shell);
  shell.append(nav, more);
  updateMobileNavHint = () => {
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    const visibleOptions = [...nav.children].filter((option) => !option.hidden);
    const lastOption = visibleOptions.at(-1);
    const hasMore = Boolean(lastOption && lastOption.getBoundingClientRect().right > nav.getBoundingClientRect().right + 3);
    more.hidden = !mobile || !hasMore;
  };
  more.onclick = () => nav.scrollBy({ left: Math.max(150, nav.clientWidth * 0.65), behavior: "smooth" });
  let scrollSettledTimer;
  nav.addEventListener("scroll", () => {
    more.hidden = true;
    clearTimeout(scrollSettledTimer);
    scrollSettledTimer = setTimeout(updateMobileNavHint, 180);
  }, { passive: true });
  window.addEventListener("resize", updateMobileNavHint);
  new MutationObserver(() => requestAnimationFrame(updateMobileNavHint)).observe(nav, { subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
  requestAnimationFrame(updateMobileNavHint);
}

function closeDestinationMenu() { $("#destination-list").hidden = true; $("#destination-trigger").setAttribute("aria-expanded", "false"); $("#destination-trigger").classList.remove("open"); }
function closeAiProviderMenu() { $("#ai-provider-options").hidden = true; $("#ai-provider-trigger").setAttribute("aria-expanded", "false"); $("#ai-provider-trigger").classList.remove("open"); }
function closeOpenAiModelMenu() { $("#openai-model-options").hidden = true; $("#openai-model-trigger").setAttribute("aria-expanded", "false"); $("#openai-model-trigger").classList.remove("open"); }
let openAiReasoningEfforts = {};
const openAiReasoningLabels = { auto: "Current bot default", none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };
const openAiSpeedLabels = { auto: "Project default", default: "Standard", fast: "Fast (higher cost)" };
function closeOpenAiOptionMenu(kind) { const menu = $(`#openai-${kind}-options`); const trigger = $(`#openai-${kind}-trigger`); menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.classList.remove("open"); }
function selectOpenAiOption(kind, value) { const labels = kind === "speed" ? openAiSpeedLabels : openAiReasoningLabels; if (!labels[value]) value = "auto"; $(`#openai-${kind}`).value = value; $(`#openai-${kind}-label`).textContent = labels[value]; document.querySelectorAll(`#openai-${kind}-options .select-option`).forEach((option) => option.setAttribute("aria-selected", String(option.dataset.value === value))); closeOpenAiOptionMenu(kind); }
function renderReasoningOptions(model) { const list = $("#openai-reasoning-options"); const choices = ["auto", ...(openAiReasoningEfforts?.[model] || ["low", "medium", "high"])]; list.replaceChildren(...choices.map((value) => { const option = document.createElement("button"); option.type = "button"; option.className = "select-option"; option.setAttribute("role", "option"); option.dataset.value = value; option.textContent = openAiReasoningLabels[value]; option.onclick = () => { selectOpenAiOption("reasoning", value); $("#openai-reasoning-trigger").focus(); }; return option; })); if (!choices.includes($("#openai-reasoning").value)) selectOpenAiOption("reasoning", "auto"); else selectOpenAiOption("reasoning", $("#openai-reasoning").value); }
function selectOpenAiModel(model) { $("#openai-model").value = model; $("#openai-model-label").textContent = model; document.querySelectorAll("#openai-model-options .select-option").forEach((option) => option.setAttribute("aria-selected", String(option.dataset.model === model))); renderReasoningOptions(model); closeOpenAiModelMenu(); }
async function loadOpenAiModels(guildId, currentModel) {
  const list = $("#openai-model-options");
  let models;
  try { ({ models, reasoningEfforts: openAiReasoningEfforts } = await api(`/api/guild/${guildId}/openai-model`)); }
  catch { models = [currentModel || "gpt-6-luna"]; }
  if (guildId !== selected) return;
  if (!models.includes(currentModel)) models = [currentModel, ...models];
  list.replaceChildren(...models.map((model) => { const option = document.createElement("button"); option.type = "button"; option.className = "select-option"; option.setAttribute("role", "option"); option.dataset.model = model; option.textContent = model; option.onclick = () => selectOpenAiModel(model); return option; }));
  selectOpenAiModel(currentModel || "gpt-6-luna");
}
function selectAiProvider(provider) { const value = provider === "openai" ? "openai" : "gemini"; $("#ai-provider").value = value; $("#ai-provider-label").textContent = value === "openai" ? "OpenAI" : "Gemini"; document.querySelectorAll("#ai-provider-options .select-option").forEach((option) => option.setAttribute("aria-selected", String(option.dataset.provider === value))); closeAiProviderMenu(); }
function renderDestinationChannels(channels) { const trigger = $("#destination-trigger"); const list = $("#destination-list"); const input = $("#destination"); input.value = ""; $("#destination-label").textContent = channels.length ? "Select an announcement channel" : "No text or announcement channels available"; trigger.disabled = !channels.length; list.innerHTML = channels.map((channel) => `<button type="button" class="select-option" role="option" data-channel-id="${channel.id}" data-channel-name="${esc(channel.name)}"># ${esc(channel.name)}${channel.type === 5 ? " · Announcement" : ""}</button>`).join(""); list.querySelectorAll(".select-option").forEach((option) => { option.onclick = () => { input.value = option.dataset.channelId; $("#destination-label").textContent = `# ${option.dataset.channelName}`; list.querySelectorAll(".select-option").forEach((item) => item.setAttribute("aria-selected", String(item === option))); closeDestinationMenu(); }; }); }
let botAccessChannels = [];
let botAccessRoles = [];
let botAccessSelections = { channels: new Set(), auto: new Set(), roles: new Set() };
const botAccessNames = { channels: "channel", auto: "auto", roles: "role" };
function botAccessItems(kind) {
  if (kind === "roles") return botAccessRoles;
  if (kind === "auto" && botAccessSelections.channels.size) return botAccessChannels.filter((channel) => botAccessSelections.channels.has(channel.id));
  return botAccessChannels;
}

function closeBotAccessMenus() {
  Object.keys(botAccessNames).forEach((kind) => {
    $(`#bot-${botAccessNames[kind]}-options`).hidden = true;
    const trigger = $(`#bot-${botAccessNames[kind]}-trigger`);
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("open");
  });
  document.querySelectorAll(".bot-access-card").forEach((card) => card.classList.remove("menu-open"));
}

function updateBotAccessLabel(kind) {
  const items = botAccessItems(kind);
  const selectedItems = items.filter((item) => botAccessSelections[kind].has(item.id));
  const label = $(`#bot-${botAccessNames[kind]}-label`);
  if (!selectedItems.length) label.textContent = kind === "channels" ? "All forum and text channels" : kind === "auto" ? "No automatic response channels" : "All server roles";
  else if (selectedItems.length === 1) label.textContent = kind === "roles" ? selectedItems[0].name : `# ${selectedItems[0].name}`;
  else label.textContent = `${selectedItems.length} ${kind === "roles" ? "roles" : "channels"} selected`;
}

function renderBotAccessOptions(kind) {
  const items = botAccessItems(kind);
  const list = $(`#bot-${botAccessNames[kind]}-options`);
  const scrollTop = list.scrollTop;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  list.innerHTML = items.length ? items.map((item) => {
    const selectedItem = botAccessSelections[kind].has(item.id);
    const roleDot = kind === "roles" ? `<span class="permission-role-dot" style="--role-color:#${(Number(item.color) || 9539985).toString(16).padStart(6, "0")}"></span>` : "";
    return `<button type="button" class="select-option multi-select-option" role="option" aria-selected="${selectedItem}" data-bot-access-kind="${kind}" data-id="${esc(item.id)}">${roleDot}<span class="multi-select-check" aria-hidden="true">✓</span><span>${kind === "roles" ? "" : "# "}${esc(item.name)}${item.type === 15 ? " · Forum" : ""}</span></button>`;
  }).join("") : '<span class="permission-no-results">No options are available.</span>';
  list.querySelectorAll("[data-bot-access-kind]").forEach((option) => {
    option.onclick = (event) => {
      event.stopPropagation();
      const selectedIds = botAccessSelections[kind];
      if (selectedIds.has(option.dataset.id)) selectedIds.delete(option.dataset.id);
      else selectedIds.add(option.dataset.id);
      if (kind === "channels") {
        const available = new Set(botAccessItems("auto").map((item) => item.id));
        for (const id of botAccessSelections.auto) if (!available.has(id)) botAccessSelections.auto.delete(id);
        renderBotAccessOptions("auto");
        updateBotAccessLabel("auto");
        $("#bot-auto-trigger").disabled = !available.size;
      }
      renderBotAccessOptions(kind);
      updateBotAccessLabel(kind);
    };
  });
  list.scrollTop = scrollTop;
  if (focusedId) [...list.querySelectorAll("[data-id]")].find((item) => item.dataset.id === focusedId)?.focus();
}

function renderBotAccessControls(channels, roles) {
  botAccessChannels = channels;
  botAccessRoles = roles;
  botAccessSelections = {
    channels: new Set((settings.botResponseChannelIds || []).filter((id) => channels.some((channel) => channel.id === id))),
    auto: new Set((settings.botAutoResponseChannelIds || []).filter((id) => channels.some((channel) => channel.id === id) && (!(settings.botResponseChannelIds || []).length || settings.botResponseChannelIds.includes(id)))),
    roles: new Set((settings.botAccessRoleIds || []).filter((id) => roles.some((role) => role.id === id))),
  };
  Object.keys(botAccessNames).forEach((kind) => {
    renderBotAccessOptions(kind);
    updateBotAccessLabel(kind);
    const trigger = $(`#bot-${botAccessNames[kind]}-trigger`);
    trigger.disabled = !botAccessItems(kind).length;
  });
}

function toggleBotAccessMenu(kind) {
  const name = botAccessNames[kind];
  const list = $(`#bot-${name}-options`);
  const opening = list.hidden;
  closeBotAccessMenus();
  if (!opening) return;
  list.hidden = false;
  $(`#bot-${name}-trigger`).setAttribute("aria-expanded", "true");
  $(`#bot-${name}-trigger`).classList.add("open");
  $(`#bot-${name}-card`).classList.add("menu-open");
}

let profilePreviewRevision = 0;
function renderProfilePreview(profile = {}, version = "") {
  const revision = ++profilePreviewRevision;
  const displayName = profile.nickname || "TheSmartBot";
  const bio = profile.bio || "Your server's helpful assistant";
  const assetVersion = encodeURIComponent(String(version || Date.now()));
  const versionedAssetUrl = (url) => `${url}${url.includes("?") ? "&" : "?"}v=${assetVersion}`;
  const avatar = $("#avatar-preview");
  const banner = $("#banner-preview");
  $("#preview-name").textContent = displayName;
  $("#preview-message-name").textContent = displayName;
  $("#preview-bio").textContent = bio;
  avatar.textContent = "";
  const avatarUrls = [...new Set([profile.avatarUrl, ...(profile.avatarUrls || [])].filter(Boolean))];
  if (avatarUrls.length) {
    const image = document.createElement("img");
    image.alt = `${displayName}'s current avatar`;
    let index = 0;
    image.onerror = () => {
      if (revision !== profilePreviewRevision) return;
      if (++index < avatarUrls.length) image.src = versionedAssetUrl(avatarUrls[index]);
      else avatar.innerHTML = '<span aria-hidden="true">✦</span>';
    };
    image.src = versionedAssetUrl(avatarUrls[index]);
    avatar.append(image);
  } else avatar.innerHTML = '<span aria-hidden="true">✦</span>';
  banner.style.backgroundImage = "";
  const bannerUrls = [...new Set([profile.bannerUrl, ...(profile.bannerUrls || [])].filter(Boolean))];
  if (bannerUrls.length) {
    const image = document.createElement("img");
    let index = 0;
    image.onload = () => {
      if (revision === profilePreviewRevision) banner.style.backgroundImage = `url("${image.src}")`;
    };
    image.onerror = () => {
      if (revision === profilePreviewRevision && ++index < bannerUrls.length) image.src = versionedAssetUrl(bannerUrls[index]);
    };
    image.src = versionedAssetUrl(bannerUrls[index]);
  }
}

function showWorkspace(tab = "overview") {
  $("#server-screen").hidden = true; $("#workspace").hidden = false;
  $("#personality-tab").hidden = true;
  $("#knowledge-tab").hidden = true;
  knowledgeDirty = false;
  closeKnowledgeMenu();
  document.querySelectorAll(".tab,.panel").forEach((element) => element.classList.remove("active"));
  $(`.tab[data-tab="${tab}"]`)?.classList.add("active"); $(`#${tab}`)?.classList.add("active");
  requestAnimationFrame(updateMobileNavHint);
}
function setPersonalityLock(locked) { const button = $("#personality-tab"); if (!button) return; const icon = button.querySelector(".lock-icon"); button.disabled = locked; button.classList.toggle("locked", locked); button.querySelector(".subtab-copy small").textContent = locked ? "Add an AI key first" : "Ready to customize"; icon.textContent = locked ? String.fromCodePoint(0x1F512) : ""; icon.hidden = !locked; }
function showTab(tab) {
  const aiSection = ["gemini", "personality", "knowledge"].includes(tab);
  $("#personality-tab").hidden = !aiSection;
  $("#knowledge-tab").hidden = !aiSection;
  const button = $(`.tab[data-tab="${tab}"], .subtab[data-tab="${tab}"]`);
  if (button?.disabled) return toast("Connect a valid AI key to unlock Personality.");
  document.querySelectorAll(".tab,.subtab,.panel").forEach((element) => element.classList.remove("active"));
  button?.classList.add("active");
  $("#gemini-tab")?.classList.toggle("expanded", aiSection);
  $(`#${tab}`)?.classList.add("active");
  if (tab === "permissions") loadPermissions().catch((error) => toast(error.message));
  if (tab === "knowledge") loadKnowledge().catch((error) => toast(error.message));
  else closeKnowledgeMenu();
  requestAnimationFrame(updateMobileNavHint);
}
function renderServers(guilds) {
  $("#signed-out").hidden = true; $("#server-list").hidden = false; $("#server-list").innerHTML = guilds.map((guild) => `<button class="server-card" data-guild="${guild.id}"><span class="server-card-icon">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">` : "✦"}</span><span><strong>${esc(guild.name)}</strong><small>Open server workspace</small></span><span class="chevron">→</span></button>`).join("") + `<a class="server-card add-server-card" href="${esc(inviteUrl)}"><span class="add-server-mark">+</span><span><strong><span class="add-server-desktop">Add TheSmartBot to another server</span><span class="add-server-mobile">Add bot to another server</span></strong><small>Choose another server you manage.</small></span><span class="chevron">→</span></a>`;
  document.querySelectorAll("[data-guild]").forEach((card) => { card.onclick = () => selectGuild(card.dataset.guild, guilds.find((guild) => guild.id === card.dataset.guild)); });
}
async function selectGuild(guildId, guild) {
  permissionMemberId = "";
  permissionRoleId = "";
  $("#permission-member-search").value = "";
  $("#permission-member-results").hidden = true;
  closePermissionRoleMenu();
  document.querySelectorAll("[data-profile-field]").forEach((form) => {
    form.reset();
    const label = form.querySelector(".file-label");
    if (label) label.textContent = `Choose ${form.dataset.profileField}`;
  });
  selected = guildId; $("#server-name").textContent = guild?.name || "Server"; $("#server-title").textContent = guild?.name || "Server settings"; $("#overview-server").textContent = guild?.name || "this server"; $("#server-icon").textContent = guild?.icon ? "" : "✦";
  if (guild?.icon) $("#server-icon").innerHTML = `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">`;
  showWorkspace(); try { await loadSettings(); } catch (error) { if (error.code === "DASHBOARD_API_UNAVAILABLE") toast("This server is connected. Settings storage is the next connection step."); else toast(error.message); }
}
async function load() {
  try {
    const me = await api("/api/me"); dashboardReady = true; inviteUrl = me.inviteUrl || "/auth/invite";
    if (!me.user) return;
    $("#login").hidden = true; $("#logout").hidden = false; $("#account").hidden = false; $("#account").textContent = `Signed in as ${me.user.username}`;
    $("#server-blessing").hidden = false;
    $("#server-screen").classList.toggle("no-connected", !me.guilds.length);
    if (!me.guilds.length) { $("#signed-out").hidden = true; $("#empty-servers").hidden = false; return; }
    renderServers(me.guilds);
  } catch (error) { if (error.code === "DASHBOARD_API_UNAVAILABLE") $("#setup-notice").textContent = "Secure dashboard sign-in is being connected."; else toast(error.message); }
}
function formatGeminiKeyEvent(event) {
  if (!event?.at) return "Date and person unavailable (saved before tracking).";
  const date = new Date(event.at);
  const dateText = Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return `added ${dateText} by ${event.byName || "unknown member"}`;
}

function renderGeminiKeyStatus(data) {
  $("#key-status-main").textContent = data.hasGeminiKey ? "A Gemini key is configured for this server." : "No Gemini key is configured yet.";
  $("#key-status-history").hidden = !data.hasGeminiKey;
  if (!data.hasGeminiKey) return;
  $("#key-current-history").textContent = `Current key: ${formatGeminiKeyEvent(data.geminiKeyHistory?.current)}`;
  $("#key-previous-history").textContent = data.geminiKeyHistory?.previous
    ? `Previous key: ${formatGeminiKeyEvent(data.geminiKeyHistory.previous)}`
    : "Previous key: No replacement details recorded.";
}

function renderOpenAiKeyStatus(data) {
  $("#openai-key-status-main").textContent = data.hasOpenAiKey ? "An OpenAI key is configured for this server." : "No OpenAI key is configured yet.";
  $("#openai-key-status-history").hidden = !data.hasOpenAiKey;
  if (!data.hasOpenAiKey) return;
  $("#openai-key-current-history").textContent = `Current key: ${formatGeminiKeyEvent(data.openAiKeyHistory?.current)}`;
  $("#openai-key-previous-history").textContent = data.openAiKeyHistory?.previous
    ? `Previous key: ${formatGeminiKeyEvent(data.openAiKeyHistory.previous)}`
    : "Previous key: No replacement details recorded.";
}

async function loadSettings() {
  const guildId = selected;
  const data = await api(`/api/guild/${guildId}/settings`);
  if (guildId !== selected) return;
  settings = data.settings;
  $("#personality-form [name=personality]").value = settings.personality || "";
  $("#profile-editor [name=nickname]").value = settings.profile?.nickname || ""; $("#profile-editor [name=bio]").value = settings.profile?.bio || "";
  renderProfilePreview(settings.profile, data.version);
  renderGeminiKeyStatus(data);
  renderOpenAiKeyStatus(data);
  selectAiProvider(settings.aiProvider);
  selectOpenAiOption("speed", settings.openAiSpeed || "auto");
  selectOpenAiOption("reasoning", settings.openAiReasoning || "auto");
  loadOpenAiModels(guildId, settings.openAiModel || "gpt-6-luna");
  setPersonalityLock(!data.hasGeminiKey && !data.hasOpenAiKey);
  renderDestinationChannels((data.channels || []).filter((channel) => [0, 5].includes(channel.type)));
  renderBotAccessControls((data.channels || []).filter((channel) => channel.type === 0 || channel.type === 15), data.roles || []);
  const channelNames = new Map((data.channels || []).map((channel) => [channel.id, channel.name]));
  $("#subscriptions").innerHTML = settings.youtubeSubscriptions?.length ? settings.youtubeSubscriptions.map((item) => `<div class="item"><span class="subscription-source"><strong>${esc(item.sourceName || "YouTube channel")}</strong></span><button type="button" class="subscription-view" data-subscription-key="${esc(subscriptionKey(item))}">View Announcement <span class="subscription-view-arrow" aria-hidden="true">→</span></button><span class="subscription-actions"><small class="subscription-destination">#${esc(channelNames.get(item.destinationChannelId) || "unknown-channel")}</small><button type="button" class="subscription-remove" aria-label="Remove this YouTube notification" title="Remove notification" data-youtube-channel-id="${esc(item.youtubeChannelId)}" data-destination-channel-id="${esc(item.destinationChannelId)}"><span aria-hidden="true">🗑︎</span></button></span></div>`).join("") : '<p class="hint">No channels are being watched yet.</p>';
  document.querySelectorAll("#subscriptions .subscription-view").forEach((button) => { button.onclick = () => { const subscription = settings.youtubeSubscriptions.find((item) => subscriptionKey(item) === button.dataset.subscriptionKey); if (subscription) openAnnouncementModal(subscription, button); }; });
  document.querySelectorAll("#subscriptions .subscription-remove").forEach((button) => { button.onclick = async () => { await api(`/api/guild/${selected}/youtube`, { method: "DELETE", body: JSON.stringify({ youtubeChannelId: button.dataset.youtubeChannelId, destinationChannelId: button.dataset.destinationChannelId }) }); toast("Notification removed."); loadSettings(); }; });
}

function closePermissionRoleMenu() {
  $("#permission-role-options").hidden = true;
  $("#permission-role-trigger").setAttribute("aria-expanded", "false");
  $("#permission-role-trigger").classList.remove("open");
  $(".permission-role-card").classList.remove("role-menu-open");
}

async function loadPermissions() {
  const guildId = selected;
  if (!guildId) return;
  const data = await api(`/api/guild/${guildId}/permissions`);
  if (guildId !== selected) return;
  $("#permission-editors").hidden = !data.canManagePermissions;
  const list = $("#permission-list");
  const avatar = (person) => person.avatarUrl
    ? `<span class="permission-person-icon"><img src="${esc(person.avatarUrl)}" alt="${esc(person.name || person.username)}'s Discord profile picture"></span>`
    : `<span class="permission-person-icon permission-avatar-fallback" aria-hidden="true">${esc((person.name || person.username || "?").slice(0, 1).toUpperCase())}</span>`;
  const personRow = (person, detail, extraClass = "") => `<div class="permission-entry ${extraClass}">${avatar(person)}<span class="permission-entry-name"><strong>${esc(person.name || person.username)}</strong><small>${esc(detail)}</small></span></div>`;
  const self = personRow(data.currentUser, `You · signed in${data.canManagePermissions ? " · server manager" : ""}`, "permission-current-user");
  const owner = data.owner && data.owner.id !== data.currentUser.id
    ? personRow(data.owner, "Server owner · always has access", "permission-owner")
    : "";
  const grants = data.grants.filter((grant) => grant.subject_type !== "user" || (grant.subject_id !== data.currentUser.id && grant.subject_id !== data.owner?.id));
  list.innerHTML = self + owner + grants.map((grant) => {
    const identity = grant.subject_type === "role"
      ? `<span class="permission-person-icon permission-role-icon" style="--role-color:#${(Number(grant.color) || 9539985).toString(16).padStart(6, "0")}" aria-hidden="true"><span></span></span>`
      : avatar({ name: grant.label, avatarUrl: grant.avatarUrl });
    return `<div class="permission-entry">${identity}<span class="permission-entry-name"><strong>${esc(grant.label)}</strong><small>${grant.subject_type === "role" ? "Anyone with this role" : "Dashboard member"}</small></span>${data.canManagePermissions ? `<button type="button" class="permission-remove" data-type="${grant.subject_type}" data-id="${esc(grant.subject_id)}" aria-label="Remove ${esc(grant.label)} from dashboard access" title="Remove access">×</button>` : ""}</div>`;
  }).join("");
  list.querySelectorAll(".permission-remove").forEach((button) => { button.onclick = async () => {
    try {
      await api(`/api/guild/${selected}/permissions`, { method: "DELETE", body: JSON.stringify({ type: button.dataset.type, id: button.dataset.id }) });
      toast("Dashboard access removed.");
      await loadPermissions();
    } catch (error) { toast(error.message); }
  }; });
  const grantedRoles = new Set(data.grants.filter((grant) => grant.subject_type === "role").map((grant) => grant.subject_id));
  const roles = data.roles.filter((role) => !grantedRoles.has(role.id));
  $("#permission-role-options").innerHTML = roles.map((role) => `<button type="button" class="select-option" role="option" data-role-id="${esc(role.id)}" data-role-name="${esc(role.name)}"><span class="permission-role-dot" style="--role-color:#${(Number(role.color) || 9539985).toString(16).padStart(6, "0")}"></span>${esc(role.name)}</button>`).join("");
  $("#permission-role-options").querySelectorAll("[data-role-id]").forEach((button) => { button.onclick = () => {
    permissionRoleId = button.dataset.roleId;
    $("#permission-role-label").textContent = button.dataset.roleName;
    $("#permission-add-role").disabled = false;
    closePermissionRoleMenu();
  }; });
  if (!roles.some((role) => role.id === permissionRoleId)) {
    permissionRoleId = "";
    $("#permission-role-label").textContent = roles.length ? "Select a role..." : "No roles available";
    $("#permission-add-role").disabled = true;
  }
  $("#permission-role-trigger").disabled = !roles.length || !data.canManagePermissions;
}

$("#permission-member-search").oninput = (event) => {
  const query = event.target.value.trim();
  permissionMemberId = "";
  clearTimeout(permissionSearchTimer);
  $("#permission-member-results").hidden = true;
  if (query.length < 2 || /^\d{15,25}$/.test(query)) return;
  const guildId = selected;
  permissionSearchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/guild/${guildId}/permissions?query=${encodeURIComponent(query)}`);
      if (guildId !== selected || $("#permission-member-search").value.trim() !== query) return;
      const list = $("#permission-member-results");
      list.innerHTML = data.members.map((member) => `<button type="button" class="select-option" role="option" data-user-id="${esc(member.id)}" data-user-name="${esc(member.name)}">${esc(member.name)} <small>@${esc(member.username)}</small></button>`).join("") || '<span class="permission-no-results">No members found. Try their Discord user ID.</span>';
      list.hidden = false;
      list.querySelectorAll("[data-user-id]").forEach((option) => { option.onclick = () => {
        permissionMemberId = option.dataset.userId;
        $("#permission-member-search").value = option.dataset.userName;
        list.hidden = true;
      }; });
    } catch (error) { toast(error.message); }
  }, 300);
};

$("#permission-member-form").onsubmit = async (event) => {
  event.preventDefault();
  const id = permissionMemberId || $("#permission-member-search").value.trim();
  try {
    await api(`/api/guild/${selected}/permissions`, { method: "POST", body: JSON.stringify({ type: "user", id }) });
    permissionMemberId = "";
    $("#permission-member-search").value = "";
    $("#permission-member-results").hidden = true;
    toast("Member can now access this dashboard.");
    await loadPermissions();
  } catch (error) { toast(error.message); }
};

$("#permission-role-trigger").onclick = () => {
  const list = $("#permission-role-options");
  const opening = list.hidden;
  list.hidden = !opening;
  $("#permission-role-trigger").setAttribute("aria-expanded", String(opening));
  $("#permission-role-trigger").classList.toggle("open", opening);
  $(".permission-role-card").classList.toggle("role-menu-open", opening);
};

$("#permission-role-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!permissionRoleId) return;
  try {
    await api(`/api/guild/${selected}/permissions`, { method: "POST", body: JSON.stringify({ type: "role", id: permissionRoleId }) });
    permissionRoleId = "";
    toast("Members with this role can now access the dashboard.");
    await loadPermissions();
  } catch (error) { toast(error.message); }
};
$("#login").onclick = () => dashboardReady ? (location = "/auth/login") : toast("The secure dashboard service is not available yet.");
$("#logout").onclick = () => { location = "/auth/logout"; };
$("#back").onclick = () => { $("#workspace").hidden = true; $("#server-screen").hidden = false; };
$("#invite").onclick = (event) => { event.currentTarget.href = inviteUrl; };
document.querySelectorAll(".tab,.subtab").forEach((button) => { button.onclick = () => showTab(button.dataset.tab); });
document.querySelectorAll("[data-open]").forEach((button) => { button.onclick = () => showTab(button.dataset.open); });
$("#personality-form").onsubmit = async (event) => { event.preventDefault(); await api(`/api/guild/${selected}/personality`, { method: "PUT", body: JSON.stringify({ personality: event.target.personality.value }) }); toast("Personality saved."); };
$("#gemini-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/gemini`, { method: "PUT", body: JSON.stringify({ apiKey: event.target.apiKey.value }) }); event.target.reset(); setPersonalityLock(false); await loadSettings(); toast(result.message || "Gemini key verified and saved."); } catch (error) { toast(error.message || "That Gemini key could not be verified."); } };
$("#openai-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/openai`, { method: "PUT", body: JSON.stringify({ apiKey: event.target.apiKey.value }) }); event.target.reset(); await loadSettings(); toast(result.message || "OpenAI key verified and saved."); } catch (error) { toast(error.message || "That OpenAI key could not be verified."); } };
$("#openai-model-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/openai-model`, { method: "PUT", body: JSON.stringify({ model: $("#openai-model").value }) }); await loadSettings(); toast(result.message || "OpenAI model updated."); } catch (error) { toast(error.message || "Could not change the OpenAI model."); } };
$("#openai-options-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/openai-options`, { method: "PUT", body: JSON.stringify({ speed: $("#openai-speed").value, reasoning: $("#openai-reasoning").value }) }); await loadSettings(); toast(result.message || "OpenAI settings updated."); } catch (error) { toast(error.message || "Could not update OpenAI settings."); } };
$("#provider-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/ai-provider`, { method: "PUT", body: JSON.stringify({ provider: $("#ai-provider").value }) }); await loadSettings(); toast(result.message || "AI provider updated."); } catch (error) { await loadSettings(); toast(error.message || "Could not change the AI provider."); } };
document.querySelectorAll("[data-profile-field]").forEach((form) => {
  form.onsubmit = async (event) => {
    event.preventDefault();
    const field = form.dataset.profileField;
    const input = form.elements.namedItem(field);
    const guildId = selected;
    const isImage = field === "avatar" || field === "banner";
    const file = isImage ? input.files[0] : null;
    const submittedValue = input.value;
    if (isImage && !file) return toast(`Choose a ${field} image first.`);
    if (file && file.size > 8 * 1024 * 1024) return toast("Images must be 8 MB or smaller.");
    const buttons = [...document.querySelectorAll("[data-profile-field] > button")];
    if (buttons.some((button) => button.disabled)) return;
    buttons.forEach((button) => { button.disabled = true; });
    form.setAttribute("aria-busy", "true");
    let saved = false;
    try {
      const body = isImage ? { [`${field}Data`]: await dataUrl(file) } : { [field]: submittedValue };
      await api(`/api/guild/${guildId}/profile`, { method: "PUT", body: JSON.stringify(body) });
      saved = true;
      if (selected !== guildId) return;
      if (isImage && input.files[0] === file) {
        input.value = "";
        form.querySelector(".file-label").textContent = `Choose replacement ${field}`;
      }
      const data = await api(`/api/guild/${guildId}/settings`);
      if (selected !== guildId) return;
      settings = data.settings;
      if (!isImage && input.value === submittedValue) input.value = settings.profile?.[field] || "";
      renderProfilePreview(settings.profile, data.version);
      toast(`${field.charAt(0).toUpperCase() + field.slice(1)} saved. Preview updated.`);
    } catch (error) {
      toast(saved ? `${field} saved, but the preview could not refresh. Reload to see it.` : error.message || `Could not save ${field}.`);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      form.removeAttribute("aria-busy");
    }
  };
});
$("#bot-access-form").onsubmit = async (event) => {
  event.preventDefault();
  const guildId = selected;
  try {
    const data = await api(`/api/guild/${guildId}/bot-access`, {
      method: "PUT",
      body: JSON.stringify({ channelIds: [...botAccessSelections.channels], autoChannelIds: [...botAccessSelections.auto], roleIds: [...botAccessSelections.roles] }),
    });
    if (guildId !== selected) return;
    settings.botResponseChannelIds = data.channelIds;
    settings.botAutoResponseChannelIds = data.autoChannelIds;
    settings.botAccessRoleIds = data.roleIds;
    toast("Bot access saved.");
  } catch (error) { toast(error.message || "Could not save bot access."); }
};
$("#youtube-form").onsubmit = async (event) => { event.preventDefault(); if (!event.target.destination.value) return toast("Select an announcement channel first."); const data = await api(`/api/guild/${selected}/youtube`, { method: "POST", body: JSON.stringify({ source: event.target.source.value, destinationChannelId: event.target.destination.value, announcementTemplate: event.target.announcementTemplate.value }) }); event.target.reset(); toast(`${data.name} is now being watched.`); loadSettings(); };
$("#announcement-editor").oninput = (event) => { $("#announcement-save").hidden = event.target.value === announcementModalState.initialValue; };
$("#announcement-close").onclick = closeAnnouncementModal;
$("#announcement-modal").onclick = (event) => { if (event.target === event.currentTarget) closeAnnouncementModal(); };
$("#announcement-modal-form").onsubmit = async (event) => {
  event.preventDefault();
  const subscription = announcementModalState.subscription;
  if (!subscription) return;
  const saveButton = $("#announcement-save");
  saveButton.disabled = true;
  try {
    const result = await api(`/api/guild/${selected}/youtube`, {
      method: "PUT",
      body: JSON.stringify({
        youtubeChannelId: subscription.youtubeChannelId,
        destinationChannelId: subscription.destinationChannelId,
        announcementTemplate: $("#announcement-editor").value,
      }),
    });
    subscription.announcementTemplate = result.announcementTemplate;
    closeAnnouncementModal();
    setTimeout(() => toast("Youtube notification updated"), 210);
  } catch (error) {
    toast(error.message || "The YouTube notification could not be updated.");
  } finally {
    saveButton.disabled = false;
  }
};
$("#destination-trigger").onclick = () => { const list = $("#destination-list"); const opening = list.hidden; list.hidden = !opening; $("#destination-trigger").setAttribute("aria-expanded", String(opening)); $("#destination-trigger").classList.toggle("open", opening); };
$("#ai-provider-trigger").onclick = () => { const list = $("#ai-provider-options"); const opening = list.hidden; list.hidden = !opening; $("#ai-provider-trigger").setAttribute("aria-expanded", String(opening)); $("#ai-provider-trigger").classList.toggle("open", opening); };
$("#openai-model-trigger").onclick = () => { const list = $("#openai-model-options"); const opening = list.hidden; list.hidden = !opening; $("#openai-model-trigger").setAttribute("aria-expanded", String(opening)); $("#openai-model-trigger").classList.toggle("open", opening); };
for (const kind of ["speed", "reasoning"]) { $(`#openai-${kind}-trigger`).onclick = () => { const list = $(`#openai-${kind}-options`); const opening = list.hidden; list.hidden = !opening; $(`#openai-${kind}-trigger`).setAttribute("aria-expanded", String(opening)); $(`#openai-${kind}-trigger`).classList.toggle("open", opening); }; }
document.querySelectorAll("#openai-speed-options .select-option").forEach((option) => { option.onclick = () => { selectOpenAiOption("speed", option.dataset.value); $("#openai-speed-trigger").focus(); }; });
document.querySelectorAll("#ai-provider-options .select-option").forEach((option) => { option.onclick = () => { selectAiProvider(option.dataset.provider); $("#ai-provider-trigger").focus(); }; });
$("#bot-channel-trigger").onclick = () => toggleBotAccessMenu("channels");
$("#bot-auto-trigger").onclick = () => toggleBotAccessMenu("auto");
$("#bot-role-trigger").onclick = () => toggleBotAccessMenu("roles");
document.addEventListener("click", (event) => { if (!event.target.closest("#destination-select")) closeDestinationMenu(); if (!event.target.closest("#ai-provider-select")) closeAiProviderMenu(); if (!event.target.closest("#openai-model-select")) closeOpenAiModelMenu(); for (const kind of ["speed", "reasoning"]) if (!event.target.closest(`#openai-${kind}-select`)) closeOpenAiOptionMenu(kind); if (!event.target.closest(".permission-role-wrap")) closePermissionRoleMenu(); if (!event.target.closest(".bot-access-select")) closeBotAccessMenus(); if (!event.target.closest(".permission-search-wrap")) $("#permission-member-results").hidden = true; });
document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!$("#announcement-modal").hidden) closeAnnouncementModal(); else { closeDestinationMenu(); closeAiProviderMenu(); closeOpenAiModelMenu(); for (const kind of ["speed", "reasoning"]) closeOpenAiOptionMenu(kind); closePermissionRoleMenu(); closeBotAccessMenus(); $("#permission-member-results").hidden = true; } });
document.querySelectorAll(".file-input").forEach((input) => { input.onchange = () => { const label = input.closest(".file-picker").querySelector(".file-label"); label.textContent = input.files[0]?.name || (input.name === "avatar" ? "Choose avatar" : "Choose banner"); }; });
setupMobileNavigationHint();
setupKnowledge();
load();
