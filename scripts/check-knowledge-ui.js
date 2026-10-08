const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the actual browser script without Discord logins or paid API requests.
const elements = new Map();
let document;
class Element {
  constructor() { this.hidden = true; this.children = []; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren(...children) { this.children = []; children.forEach((c) => this.append(c)); }
  contains(element) { return element === this || this.children.some((c) => c.contains(element)); }
  focus() { document.activeElement = this; }
  querySelectorAll(selector) {
    const all = this.children.flatMap((c) => [c, ...c.querySelectorAll("*")]);
    if (selector === "*") return all;
    return all.filter((c) => c.tag === "button" && (!selector.includes('aria-selected="true"') || c.attributes["aria-selected"] === "true"));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const $ = (selector) => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
document = { activeElement: null, hidden: false, createElement(tag) { const el = new Element(); el.tag = tag; return el; }, addEventListener() {} };
const channelId = "100000000000000001", otherId = "100000000000000002";
let serverPolicy = { knowledgeOnly: false, requireCitations: false, citationCount: 3, generalChannels: [], uncitedChannels: [] };
let saved;
const context = vm.createContext({ document, $, esc: (v) => v, selected: "guild-one", toast() {}, setInterval() {}, console,
  api: async (url, opts) => {
    if (opts) { saved = JSON.parse(opts.body); if (saved.policy) serverPolicy = saved.policy; return { message: "Saved" }; }
    return { channelIds: [], channels: [{ id: channelId, name: "forum", type: 15 }, { id: otherId, name: "chat", type: 0 }], policy: structuredClone(serverPolicy) };
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../dashboard/knowledge.js"), "utf8"), context);
const run = (text) => vm.runInContext(text, context);
async function main() {
  run("setupKnowledge()"); await run("loadKnowledge()");
  assert.equal($("#knowledge-only").checked, false);
  assert.equal($("#knowledge-citations").checked, false);
  assert.equal($("#knowledge-exceptions").hidden, true);
  $("#knowledge-citations").onchange({ target: { checked: true } });
  assert.equal($("#knowledge-count-field").hidden, false);
  assert.equal($("#knowledge-general-field").hidden, true);
  assert.equal($("#knowledge-uncited-field").hidden, false);
  $("#knowledge-uncited-trigger").onclick();
  const choose = (i) => $("#knowledge-uncited-options").querySelectorAll("button")[i].onclick({ stopPropagation() {} });
  choose(0); choose(1);
  assert.equal($("#knowledge-uncited-options").hidden, false, "Multi-select stays open across selections");
  await run("loadKnowledge()");
  assert.equal($("#knowledge-citations").checked, true, "Polling must preserve unsaved toggle");
  assert.equal($("#knowledge-uncited-label").textContent, "2 channels selected", "Polling must preserve unsaved exceptions");
  $("#knowledge-uncited-trigger").onclick();
  assert.equal($("#knowledge-uncited-options").hidden, true);
  $("#knowledge-count-trigger").onclick();
  $("#knowledge-count-options").querySelectorAll("button")[4].onclick({ stopPropagation() {} });
  assert.equal($("#knowledge-count-options").hidden, true, "Single-select closes on selection");
  assert.equal($("#knowledge-count-label").textContent, "5");
  const submit = new Element(); submit.tag = "button";
  await $("#knowledge-policy-form").onsubmit({ preventDefault() {}, target: { querySelector: () => submit } });
  assert.equal(saved.policy.knowledgeOnly, false);
  assert.equal(saved.policy.requireCitations, true);
  assert.deepEqual(saved.policy.uncitedChannels, [channelId, otherId]);
  assert.equal(saved.channelIds, undefined, "Policy save must not overwrite source selection");
  $("#knowledge-only").onchange({ target: { checked: true } });
  assert.equal($("#knowledge-general-field").hidden, false);
  await run("loadKnowledge(true)");
  assert.equal($("#knowledge-only").checked, true, "Saving sources must not discard unsaved policy edits");
  context.selected = "guild-two";
  serverPolicy = { knowledgeOnly: false, requireCitations: false, citationCount: 3, generalChannels: [], uncitedChannels: [] };
  await run("loadKnowledge()");
  assert.equal($("#knowledge-only").checked, false, "Switching guilds must discard previous guild's draft");
  console.log("Knowledge UI independent switches, multi/single dropdown behavior, polling, saving, and guild isolation passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
