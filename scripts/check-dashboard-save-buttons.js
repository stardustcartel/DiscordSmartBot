const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../dashboard/app.js"), "utf8");
const implementation = source.slice(source.indexOf("const sameSelection ="), source.indexOf("const dataUrl ="));
const elements = new Map();
const form = () => ({ getAttribute: () => null });
function $(selector) {
  if (!elements.has(selector)) elements.set(selector, { value: "", disabled: false, hidden: false, closest: form });
  return elements.get(selector);
}
const profiles = ["avatar", "banner", "nickname", "bio"].map((field) => ({
  dataset: { profileField: field },
  elements: { namedItem: () => field === "avatar" || field === "banner" ? { files: [] } : { value: "" } },
}));
const context = vm.createContext({ $, document: { querySelector: () => null, querySelectorAll: () => profiles }, selected: "guild", settingsLoadedGuild: "guild",
  settings: { personality: "Be helpful", profile: { nickname: "Teddy", bio: "Hello" }, aiProvider: "gemini", openAiModel: "gpt-6-luna", openAiSpeed: "auto", openAiReasoning: "auto", botResponseChannelIds: [], botAutoResponseChannelIds: [], botAccessRoleIds: [] },
  botAccessSelections: { channels: new Set(), auto: new Set(), roles: new Set() },
  permissionMemberId: "", permissionRoleId: "", announcementModalState: { initialValue: "saved" }, defaultAnnouncementTemplate: "default", updateKnowledgeSaveButtons() {},
});
vm.runInContext(implementation, context);
const update = () => vm.runInContext("updateSaveButtons()", context);
$("#personality-form [name=personality]").value = "Be helpful";
$("#ai-provider").value = "gemini";
$("#openai-model").value = "gpt-6-luna";
$("#openai-speed").value = "auto";
$("#openai-reasoning").value = "auto";
$("#announcement-save").hidden = true;
$("#announcement-editor").value = "saved";
profiles[2].elements.namedItem = () => ({ value: "Teddy" });
profiles[3].elements.namedItem = () => ({ value: "Hello" });
update();
for (const selector of ["#personality-form", "#provider-form", "#openai-model-form", "#openai-options-form", "#bot-access-form", "#youtube-form", "#gemini-form", "#openai-form", "#permission-member-form", "#permission-role-form", '[data-profile-field="avatar"]', '[data-profile-field="bio"]']) {
  assert.equal($(`${selector} button[type=submit]`).disabled, true, `${selector} starts disabled when empty or unchanged`);
}
$("#personality-form [name=personality]").value = "Different";
update(); assert.equal($("#personality-form button[type=submit]").disabled, false);
$("#personality-form [name=personality]").value = "Be helpful";
update(); assert.equal($("#personality-form button[type=submit]").disabled, true, "Reverting a value disables Save again");
$("#personality-form [name=personality]").value = "   ";
update(); assert.equal($("#personality-form button[type=submit]").disabled, true, "Blank personality cannot be saved even if the previous value was not blank");
$("#personality-form [name=personality]").value = "Be helpful";
$("#ai-provider").value = "openai";
$("#openai-speed").value = "fast";
$("#openai-model").value = "gpt-6-sol";
context.botAccessSelections.channels.add("channel-one");
$("#gemini-form [name=apiKey]").value = "new-key";
profiles[0].elements.namedItem = () => ({ files: [{ name: "avatar.png" }] });
update();
for (const selector of ["#provider-form", "#openai-model-form", "#openai-options-form", "#bot-access-form", "#gemini-form", '[data-profile-field="avatar"]']) {
  assert.equal($(`${selector} button[type=submit]`).disabled, false, `${selector} enables after an edit`);
}
context.settingsLoadedGuild = "another-guild";
update(); assert.equal($("#provider-form button[type=submit]").disabled, true, "Buttons cannot save while another guild loads");
context.settingsLoadedGuild = "guild";
context.settings.youtubeSubscriptions = [{ sourceUrl: "https://www.youtube.com/channel/UC12345678901234567890", youtubeChannelId: "UC12345678901234567890", destinationChannelId: "channel-one", announcementTemplate: "A video" }];
$("#youtube-form [name=source]").value = "https://www.youtube.com/channel/UC12345678901234567890";
$("#destination").value = "channel-one";
$("#youtube-form [name=announcementTemplate]").value = "A video";
update(); assert.equal($("#youtube-form button[type=submit]").disabled, true, "Identical YouTube notification cannot be resaved");
$("#youtube-form [name=announcementTemplate]").value = "A different video";
update(); assert.equal($("#youtube-form button[type=submit]").disabled, false, "A changed YouTube message can be saved");
const html = fs.readFileSync(path.join(__dirname, "../dashboard/index.html"), "utf8");
assert.match(html, /id="personality-form"[^]*?<button type="submit">Save personality<\/button>/);
for (const id of ["youtube-form", "gemini-form", "openai-form"]) {
  assert.match(html, new RegExp(`id="${id}"[^]*?<button>Save [^<]+<\\/button>`), `${id} currently uses an implicit submit button`);
}
const implicitElements = new Map();
const implicit$ = (selector) => {
  if (["youtube-form", "gemini-form", "openai-form"].some((id) => selector === `#${id} button[type=submit]`)) return null;
  if (!implicitElements.has(selector)) implicitElements.set(selector, { value: "", disabled: false, hidden: false, closest: form });
  return implicitElements.get(selector);
};
const implicitContext = vm.createContext({ ...context, $: implicit$, selected: "guild", settingsLoadedGuild: "guild" });
vm.runInContext(implementation, implicitContext);
vm.runInContext("updateSaveButtons()", implicitContext);
for (const id of ["youtube-form", "gemini-form", "openai-form"]) assert.equal(implicit$(`#${id} button:not([type])`).disabled, true, `${id} implicit submit button is disabled when empty`);
implicit$("#gemini-form [name=apiKey]").value = "a-new-key";
vm.runInContext("updateSaveButtons()", implicitContext);
assert.equal(implicit$("#gemini-form button:not([type])").disabled, false, "Implicit submit button enables when filled");
console.log("Dashboard Save buttons reflect empty, unchanged, edited, reverted, and guild-loading states.");
