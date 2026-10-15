import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'htmlparser2';

const html = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../dashboard/app.js', import.meta.url), 'utf8');
const patreon = readFileSync(new URL('../dashboard/patreon.js', import.meta.url), 'utf8');
const document = parseDocument(html);
const nodes = [];
function visit(node) { nodes.push(node); for (const child of node.children || []) visit(child); }
visit(document);
const byId = id => nodes.find(node => node.attribs?.id === id);
const ancestor = (node, id) => { for (let parent = node?.parent; parent; parent = parent.parent) if (parent.attribs?.id === id) return true; return false; };
const nav = nodes.find(node => node.name === 'nav');
const navIds = nav.children.filter(node => node.name === 'button').map(node => node.attribs?.id || node.attribs?.['data-tab']);
assert.ok(navIds.indexOf('knowledge-tab') < navIds.indexOf('knowledge-discord-tab'));
assert.ok(navIds.indexOf('knowledge-discord-tab') < navIds.indexOf('knowledge-patreon-tab'));
assert.equal(byId('knowledge-discord-tab').attribs['data-tab'], 'knowledge');
assert.equal(byId('knowledge-patreon-tab').attribs['data-tab'], 'patreon');
assert.ok(ancestor(byId('knowledge-form'), 'knowledge'));
assert.ok(ancestor(byId('knowledge-policy-form'), 'knowledge'));
assert.ok(ancestor(byId('knowledge-status'), 'knowledge'));
assert.ok(ancestor(byId('patreon-card'), 'patreon'));
assert.ok(!ancestor(byId('patreon-card'), 'knowledge'));
assert.ok(!ancestor(byId('knowledge-form'), 'patreon'));
assert.match(app, /if \(tab === "patreon"\) loadPatreon\(\)/);
assert.match(app, /showTab\("patreon"\)/);
assert.match(patreon, /sourceChannels[\s\S]*?\.channels/);
console.log('Knowledge Base Discord/Patreon navigation and panel separation passed.');
