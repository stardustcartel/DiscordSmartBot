const $ = (selector) => document.querySelector(selector);
let selected = "";
let settings = {};
let inviteUrl = "/auth/invite";
let dashboardReady = false;
const defaultAnnouncementTemplate = "📺 **{channel} uploaded a new video:**\n**{title}**";
const announcementModalState = { subscription: null, initialValue: "", trigger: null, closeTimer: null };

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
function renderDestinationChannels(channels) { const trigger = $("#destination-trigger"); const list = $("#destination-list"); const input = $("#destination"); input.value = ""; $("#destination-label").textContent = channels.length ? "Select an announcement channel" : "No text channels available"; trigger.disabled = !channels.length; list.innerHTML = channels.map((channel) => `<button type="button" class="select-option" role="option" data-channel-id="${channel.id}" data-channel-name="${esc(channel.name)}"># ${esc(channel.name)}</button>`).join(""); list.querySelectorAll(".select-option").forEach((option) => { option.onclick = () => { input.value = option.dataset.channelId; $("#destination-label").textContent = `# ${option.dataset.channelName}`; list.querySelectorAll(".select-option").forEach((item) => item.setAttribute("aria-selected", String(item === option))); closeDestinationMenu(); }; }); }
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
  document.querySelectorAll(".tab,.panel").forEach((element) => element.classList.remove("active"));
  $(`.tab[data-tab="${tab}"]`)?.classList.add("active"); $(`#${tab}`)?.classList.add("active");
  requestAnimationFrame(updateMobileNavHint);
}
function setPersonalityLock(locked) { const button = $("#personality-tab"); if (!button) return; const icon = button.querySelector(".lock-icon"); button.disabled = locked; button.classList.toggle("locked", locked); button.querySelector(".subtab-copy small").textContent = locked ? "Add Gemini key first" : "Ready to customize"; icon.textContent = locked ? String.fromCodePoint(0x1F512) : ""; icon.hidden = !locked; }
function showTab(tab) { if (tab === "gemini") $("#personality-tab").hidden = false; else if (tab !== "personality") $("#personality-tab").hidden = true; const button = $(`.tab[data-tab="${tab}"], .subtab[data-tab="${tab}"]`); if (button?.disabled) return toast("Connect a valid Gemini key to unlock Personality."); document.querySelectorAll(".tab,.subtab,.panel").forEach((element) => element.classList.remove("active")); button?.classList.add("active"); $("#gemini-tab")?.classList.toggle("expanded", tab === "gemini"); $(`#${tab}`)?.classList.add("active"); requestAnimationFrame(updateMobileNavHint); }
function renderServers(guilds) {
  $("#signed-out").hidden = true; $("#server-list").hidden = false; $("#server-list").innerHTML = guilds.map((guild) => `<button class="server-card" data-guild="${guild.id}"><span class="server-card-icon">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">` : "✦"}</span><span><strong>${esc(guild.name)}</strong><small>Open server workspace</small></span><span class="chevron">→</span></button>`).join("") + `<a class="server-card add-server-card" href="${esc(inviteUrl)}"><span class="add-server-mark">+</span><span><strong><span class="add-server-desktop">Add TheSmartBot to another server</span><span class="add-server-mobile">Add bot to another server</span></strong><small>Choose another server you manage.</small></span><span class="chevron">→</span></a>`;
  document.querySelectorAll("[data-guild]").forEach((card) => { card.onclick = () => selectGuild(card.dataset.guild, guilds.find((guild) => guild.id === card.dataset.guild)); });
}
async function selectGuild(guildId, guild) {
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
async function loadSettings() {
  const guildId = selected;
  const data = await api(`/api/guild/${guildId}/settings`);
  if (guildId !== selected) return;
  settings = data.settings;
  $("#personality-form [name=personality]").value = settings.personality || "";
  $("#profile-editor [name=nickname]").value = settings.profile?.nickname || ""; $("#profile-editor [name=bio]").value = settings.profile?.bio || "";
  renderProfilePreview(settings.profile, data.version);
  $("#key-status").textContent = data.hasGeminiKey ? "A Gemini key is configured for this server." : "No Gemini key is configured yet.";
  setPersonalityLock(!data.hasGeminiKey);
  renderDestinationChannels(data.channels || []);
  const channelNames = new Map((data.channels || []).map((channel) => [channel.id, channel.name]));
  $("#subscriptions").innerHTML = settings.youtubeSubscriptions?.length ? settings.youtubeSubscriptions.map((item) => `<div class="item"><span class="subscription-source"><strong>${esc(item.sourceName || "YouTube channel")}</strong></span><button type="button" class="subscription-view" data-subscription-key="${esc(subscriptionKey(item))}">View Announcement <span class="subscription-view-arrow" aria-hidden="true">→</span></button><span class="subscription-actions"><small class="subscription-destination">#${esc(channelNames.get(item.destinationChannelId) || "unknown-channel")}</small><button type="button" class="subscription-remove" aria-label="Remove this YouTube notification" title="Remove notification" data-youtube-channel-id="${esc(item.youtubeChannelId)}" data-destination-channel-id="${esc(item.destinationChannelId)}"><span aria-hidden="true">🗑︎</span></button></span></div>`).join("") : '<p class="hint">No channels are being watched yet.</p>';
  document.querySelectorAll("#subscriptions .subscription-view").forEach((button) => { button.onclick = () => { const subscription = settings.youtubeSubscriptions.find((item) => subscriptionKey(item) === button.dataset.subscriptionKey); if (subscription) openAnnouncementModal(subscription, button); }; });
  document.querySelectorAll("#subscriptions .subscription-remove").forEach((button) => { button.onclick = async () => { await api(`/api/guild/${selected}/youtube`, { method: "DELETE", body: JSON.stringify({ youtubeChannelId: button.dataset.youtubeChannelId, destinationChannelId: button.dataset.destinationChannelId }) }); toast("Notification removed."); loadSettings(); }; });
}
$("#login").onclick = () => dashboardReady ? (location = "/auth/login") : toast("The secure dashboard service is not available yet.");
$("#logout").onclick = () => { location = "/auth/logout"; };
$("#back").onclick = () => { $("#workspace").hidden = true; $("#server-screen").hidden = false; };
$("#invite").onclick = (event) => { event.currentTarget.href = inviteUrl; };
document.querySelectorAll(".tab,.subtab").forEach((button) => { button.onclick = () => showTab(button.dataset.tab); });
document.querySelectorAll("[data-open]").forEach((button) => { button.onclick = () => showTab(button.dataset.open); });
$("#personality-form").onsubmit = async (event) => { event.preventDefault(); await api(`/api/guild/${selected}/personality`, { method: "PUT", body: JSON.stringify({ personality: event.target.personality.value }) }); toast("Personality saved."); };
$("#gemini-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/gemini`, { method: "PUT", body: JSON.stringify({ apiKey: event.target.apiKey.value }) }); event.target.reset(); setPersonalityLock(false); toast(result.message || "Gemini key verified and saved."); loadSettings(); } catch (error) { toast(error.message || "That Gemini key could not be verified."); } };
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
document.addEventListener("click", (event) => { if (!event.target.closest("#destination-select")) closeDestinationMenu(); });
document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!$("#announcement-modal").hidden) closeAnnouncementModal(); else closeDestinationMenu(); });
document.querySelectorAll(".file-input").forEach((input) => { input.onchange = () => { const label = input.closest(".file-picker").querySelector(".file-label"); label.textContent = input.files[0]?.name || (input.name === "avatar" ? "Choose avatar" : "Choose banner"); }; });
setupMobileNavigationHint();
load();
