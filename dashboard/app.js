const $ = (selector) => document.querySelector(selector);
let selected;
let settings;
let dashboardReady = false;

const esc = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const toast = (message) => {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 4200);
};
const api = (url, options = {}) => fetch(url, { headers: { "Content-Type": "application/json" }, ...options }).then(async (response) => {
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    const error = Error("Dashboard service unavailable");
    error.code = "DASHBOARD_API_UNAVAILABLE";
    throw error;
  }
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Something went wrong");
  return data;
});
const dataUrl = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve("");
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

async function load() {
  try {
    const me = await api("/api/me");
    dashboardReady = true;
    if (!me.user) return;
    $("#login").hidden = true;
    $("#account").hidden = false;
    $("#account").textContent = `Signed in as ${me.user.username}`;
    $("#welcome").hidden = true;
    $("#app").hidden = false;
    const guild = $("#guild");
    guild.innerHTML = me.guilds.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
    if (!me.guilds.length) return toast("Add the bot to a server you manage first.");
    guild.onchange = loadSettings;
    await loadSettings();
  } catch (error) {
    if (error.code !== "DASHBOARD_API_UNAVAILABLE") throw error;
    $("#setup-notice").hidden = false;
  }
}

async function loadSettings() {
  selected = $("#guild").value;
  const data = await api(`/api/guild/${selected}/settings`);
  settings = data.settings;
  $("#personality-form [name=personality]").value = settings.personality;
  $("#profile-form [name=nickname]").value = settings.profile.nickname;
  $("#profile-form [name=bio]").value = settings.profile.bio;
  $("#key-status").textContent = data.hasGeminiKey ? "A Gemini key is configured for this server." : "No Gemini key is configured yet.";
  $("#destination").innerHTML = data.channels.map((channel) => `<option value="${channel.id}"># ${esc(channel.name)}</option>`).join("");
  $("#subscriptions").innerHTML = settings.youtubeSubscriptions.length
    ? settings.youtubeSubscriptions.map((subscription) => `<div class="item"><span><strong>${esc(subscription.sourceName || "YouTube channel")}</strong><br><small>→ &lt;#${subscription.destinationChannelId}&gt;</small></span><button data-id="${subscription.youtubeChannelId}">Remove</button></div>`).join("")
    : '<p class="hint">No channels are being watched yet.</p>';
  document.querySelectorAll("[data-id]").forEach((button) => {
    button.onclick = async () => {
      await api(`/api/guild/${selected}/youtube`, { method: "DELETE", body: JSON.stringify({ youtubeChannelId: button.dataset.id }) });
      toast("Notification removed.");
      loadSettings();
    };
  });
}

$("#login").onclick = () => {
  if (!dashboardReady) return toast("Secure Discord sign-in is being connected now. The site is live, but configuration needs its private backend.");
  location = "/auth/login";
};
document.querySelectorAll(".tab").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll(".tab,.panel").forEach((element) => element.classList.remove("active"));
    button.classList.add("active");
    $(`#${button.dataset.tab}`).classList.add("active");
  };
});
$("#personality-form").onsubmit = async (event) => {
  event.preventDefault();
  await api(`/api/guild/${selected}/personality`, { method: "PUT", body: JSON.stringify({ personality: event.target.personality.value }) });
  toast("Personality saved.");
};
$("#gemini-form").onsubmit = async (event) => {
  event.preventDefault();
  await api(`/api/guild/${selected}/gemini`, { method: "PUT", body: JSON.stringify({ apiKey: event.target.apiKey.value }) });
  event.target.reset();
  toast("Gemini key encrypted and saved.");
  loadSettings();
};
$("#profile-form").onsubmit = async (event) => {
  event.preventDefault();
  await api(`/api/guild/${selected}/profile`, { method: "PUT", body: JSON.stringify({ nickname: event.target.nickname.value, bio: event.target.bio.value, avatarData: await dataUrl(event.target.avatar.files[0]), bannerData: await dataUrl(event.target.banner.files[0]) }) });
  toast("Bot profile updated.");
};
$("#youtube-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = await api(`/api/guild/${selected}/youtube`, { method: "POST", body: JSON.stringify({ source: event.target.source.value, destinationChannelId: event.target.destination.value }) });
  event.target.reset();
  toast(`${data.name} is now being watched.`);
  loadSettings();
};

load().catch((error) => toast(error.message));
