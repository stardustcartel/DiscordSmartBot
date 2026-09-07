const $ = (selector) => document.querySelector(selector);
let selected = "";
let settings = {};
let inviteUrl = "/auth/invite";
let dashboardReady = false;

const esc = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const toast = (message) => { const element = $("#toast"); element.textContent = message; element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 4200); };
const api = (url, options = {}) => fetch(url, { headers: { "Content-Type": "application/json" }, ...options }).then(async (response) => {
  if (!(response.headers.get("content-type") || "").includes("application/json")) { const error = Error("Dashboard service unavailable"); error.code = "DASHBOARD_API_UNAVAILABLE"; throw error; }
  const data = await response.json(); if (!response.ok) throw Error(data.error || "Something went wrong"); return data;
});
const dataUrl = (file) => new Promise((resolve, reject) => { if (!file) return resolve(""); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });

function showWorkspace(tab = "overview") {
  $("#server-screen").hidden = true; $("#workspace").hidden = false;
  document.querySelectorAll(".tab,.panel").forEach((element) => element.classList.remove("active"));
  $(`.tab[data-tab="${tab}"]`)?.classList.add("active"); $(`#${tab}`)?.classList.add("active");
}
function setPersonalityLock(locked) { const button = $("#personality-tab"); if (!button) return; button.disabled = locked; button.classList.toggle("locked", locked); button.querySelector(".subtab-copy small").textContent = locked ? "Add Gemini key first" : "Ready to customize"; button.querySelector(".lock-icon").hidden = !locked; }
function showTab(tab) { if (tab === "gemini") $("#personality-tab").hidden = false; const button = $(`.tab[data-tab="${tab}"], .subtab[data-tab="${tab}"]`); if (button?.disabled) return toast("Connect a valid Gemini key to unlock Personality."); document.querySelectorAll(".tab,.subtab,.panel").forEach((element) => element.classList.remove("active")); button?.classList.add("active"); $("#gemini-tab")?.classList.toggle("expanded", tab === "gemini"); $(`#${tab}`)?.classList.add("active"); }
function renderServers(guilds) {
  $("#signed-out").hidden = true; $("#server-list").hidden = false; $("#server-list").innerHTML = guilds.map((guild) => `<button class="server-card" data-guild="${guild.id}"><span class="server-card-icon">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">` : "✦"}</span><span><strong>${esc(guild.name)}</strong><small>Open server workspace</small></span><span class="chevron">→</span></button>`).join("");
  document.querySelectorAll("[data-guild]").forEach((card) => { card.onclick = () => selectGuild(card.dataset.guild, guilds.find((guild) => guild.id === card.dataset.guild)); });
}
async function selectGuild(guildId, guild) {
  selected = guildId; $("#server-name").textContent = guild?.name || "Server"; $("#server-title").textContent = guild?.name || "Server settings"; $("#overview-server").textContent = guild?.name || "this server"; $("#server-icon").textContent = guild?.icon ? "" : "✦";
  if (guild?.icon) $("#server-icon").innerHTML = `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">`;
  showWorkspace(); try { await loadSettings(); } catch (error) { if (error.code === "DASHBOARD_API_UNAVAILABLE") toast("This server is connected. Settings storage is the next connection step."); else toast(error.message); }
}
async function load() {
  try {
    const me = await api("/api/me"); dashboardReady = true; inviteUrl = me.inviteUrl || "/auth/invite";
    if (!me.user) return;
    $("#login").hidden = true; $("#account").hidden = false; $("#account").textContent = `Signed in as ${me.user.username}`;
    if (!me.guilds.length) { $("#signed-out").hidden = true; $("#empty-servers").hidden = false; return; }
    renderServers(me.guilds);
  } catch (error) { if (error.code === "DASHBOARD_API_UNAVAILABLE") $("#setup-notice").textContent = "Secure dashboard sign-in is being connected."; else toast(error.message); }
}
async function loadSettings() {
  const data = await api(`/api/guild/${selected}/settings`); settings = data.settings;
  $("#personality-form [name=personality]").value = settings.personality || "";
  $("#profile-form [name=nickname]").value = settings.profile?.nickname || ""; $("#profile-form [name=bio]").value = settings.profile?.bio || "";
  $("#preview-name").textContent = settings.profile?.nickname || "TheSmartBot"; $("#preview-bio").textContent = settings.profile?.bio || "Your server's helpful assistant";
  if (settings.profile?.avatarUrl) $("#avatar-preview").innerHTML = `<img src="${esc(settings.profile.avatarUrl)}" alt="Current bot avatar">`;
  $("#key-status").textContent = data.hasGeminiKey ? "A Gemini key is configured for this server." : "No Gemini key is configured yet.";
  setPersonalityLock(!data.hasGeminiKey);
  $("#destination").innerHTML = (data.channels || []).map((channel) => `<option value="${channel.id}"># ${esc(channel.name)}</option>`).join("");
  $("#subscriptions").innerHTML = settings.youtubeSubscriptions?.length ? settings.youtubeSubscriptions.map((item) => `<div class="item"><span><strong>${esc(item.sourceName || "YouTube channel")}</strong><br><small>→ &lt;#${item.destinationChannelId}&gt;</small></span><button data-id="${item.youtubeChannelId}">Remove</button></div>`).join("") : '<p class="hint">No channels are being watched yet.</p>';
}
$("#login").onclick = () => dashboardReady ? (location = "/auth/login") : toast("The secure dashboard service is not available yet.");
$("#back").onclick = () => { $("#workspace").hidden = true; $("#server-screen").hidden = false; };
$("#invite").onclick = (event) => { event.currentTarget.href = inviteUrl; };
document.querySelectorAll(".tab,.subtab").forEach((button) => { button.onclick = () => showTab(button.dataset.tab); });
document.querySelectorAll("[data-open]").forEach((button) => { button.onclick = () => showTab(button.dataset.open); });
$("#personality-form").onsubmit = async (event) => { event.preventDefault(); await api(`/api/guild/${selected}/personality`, { method: "PUT", body: JSON.stringify({ personality: event.target.personality.value }) }); toast("Personality saved."); };
$("#gemini-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`/api/guild/${selected}/gemini`, { method: "PUT", body: JSON.stringify({ apiKey: event.target.apiKey.value }) }); event.target.reset(); setPersonalityLock(false); toast(result.message || "Gemini key verified and saved."); loadSettings(); } catch (error) { toast(error.message || "That Gemini key could not be verified."); } };
$("#profile-form").onsubmit = async (event) => { event.preventDefault(); await api(`/api/guild/${selected}/profile`, { method: "PUT", body: JSON.stringify({ nickname: event.target.nickname.value, bio: event.target.bio.value, avatarData: await dataUrl(event.target.avatar.files[0]), bannerData: await dataUrl(event.target.banner.files[0]) }) }); toast("Bot profile updated."); loadSettings(); };
$("#youtube-form").onsubmit = async (event) => { event.preventDefault(); const data = await api(`/api/guild/${selected}/youtube`, { method: "POST", body: JSON.stringify({ source: event.target.source.value, destinationChannelId: event.target.destination.value }) }); event.target.reset(); toast(`${data.name} is now being watched.`); loadSettings(); };
document.querySelectorAll(".file-input").forEach((input) => { input.onchange = () => { const label = input.closest(".file-picker").querySelector(".file-label"); label.textContent = input.files[0]?.name || (input.name === "avatar" ? "Choose avatar" : "Choose banner"); }; });
load();
