const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ReminderStore, parseReminderTime } = require('../src/reminders');
const { ReminderCommands, reminderCommand, registerPrivateReminders } = require('../src/reminder-commands');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbot-reminders-'));
const user = '100000000000000001', other = '100000000000000002', third = '100000000000000003', stranger = '100000000000000004', channelId = '100000000000000005';
let now = Date.parse('2026-10-27T20:00:00Z');
const realNow = Date.now; Date.now = () => now;
const store = () => new ReminderStore({ dataDirectory: root, reminderDefaultTimeZone: 'America/Los_Angeles' });
let db = store();
const delivered = [], blocked = new Set();
const client = { users: { fetch: async id => ({ id, bot: false, send: async payload => { if (blocked.has(id)) throw Object.assign(new Error('Cannot send messages'),{code:50007}); delivered.push({ id, payload }); } }) } };
function interaction({ author = user, notify = [], message = 'Attend Q&A', when = 'in 30 mins', zone, channel = channelId, guildId = null, customId } = {}) {
  const replies=[];
  return { user:{id:author}, channelId:channel, guildId, customId, replies, options: {
    getString: name => ({message,when,'time-zone':zone})[name] || null,
    getUser: name => { const index = name === 'notify' ? 0 : Number(name.split('-')[1])-1; return notify[index] || null; },
  }, deferReply:async()=>{replies.push({deferred:true});}, reply:async data=>{replies.push(data);}, editReply:async data=>{replies.push(data);} };
}
(async()=>{
  const global = reminderCommand(true).toJSON(), guild = reminderCommand().toJSON();
  assert.equal(global.name,'remind'); assert.deepEqual(global.contexts,[1,2]); assert.deepEqual(global.integration_types,[1]);
  assert.equal(global.options.filter(o=>o.type===6).length,10); assert.equal(guild.dm_permission,false);
  let configured={ '0':{oauth2_install_params:{scopes:['bot','applications.commands'],permissions:'2048'}} }, registered, patches=0;
  const registration={rest:{get:async()=>({integration_types_config:configured}),patch:async(_route,{body})=>{patches++;configured=body.integration_types_config;}},application:{commands:{set:async commands=>{registered=commands.map(c=>c.toJSON());}}}};
  await registerPrivateReminders(registration);
  assert.equal(patches,1); assert.equal(configured['0'].oauth2_install_params.permissions,'2048');
  assert.deepEqual(registered.map(c=>c.name),['remind'],'Global /chat and management commands stay absent');
  await registerPrivateReminders(registration); assert.equal(patches,1,'Existing user install settings are not overwritten');

  assert.equal(parseReminderTime('in 2 hrs',now,'UTC'),now+7200000);
  assert.equal(parseReminderTime('tomorrow at noon PST',now,'UTC'),Date.parse('2026-10-28T20:00:00Z'));
  assert.equal(parseReminderTime('10/28/2026 at noon UTC',now,'UTC'),Date.parse('2026-10-28T12:00:00Z'));
  assert.equal(parseReminderTime('nonsense',now,'UTC'),null);
  let commands=new ReminderCommands(db,()=>({reminderTimeZone:'UTC'}));
  let request=interaction(); await commands.create(request);
  assert.equal(db.reminders.length,1); assert.equal(db.reminders[0].recipients,undefined,'Existing self-only storage remains compatible');
  assert.match(request.replies.at(-1),/I will DM you/);
  now+=1800001; await db.processDue(client);
  assert.equal(delivered.length,1); assert.equal(delivered[0].id,user); assert.equal(db.reminders.length,0);
  delivered.length=0;

  request=interaction({notify:[{id:other},{id:other},{id:third}]});await commands.create(request);
  let record=db.reminders[0], id=record.id;
  assert.deepEqual(record.recipients.map(r=>r.userId),[other,third],'Recipients are deduplicated; creator is not implicitly included');
  assert.ok(record.recipients.every(r=>r.status==='pending')); assert.equal(delivered.length,0,'Selecting someone never sends an unsolicited DM');
  const confirm=async(author,action='accept',channel=channelId)=>{const i=interaction({author,customId:`reminder:${action}:${id}`,channel});await commands.button(i);return i.replies.at(-1).content;};
  assert.match(await confirm(stranger),/not selected/);
  assert.match(await confirm(other,'accept','other-channel'),/no longer active here/);
  assert.match(await confirm(other,'cancel'),/Only the person/);
  assert.match(await confirm(other),/scheduled for a private reminder/);
  await confirm(other); assert.equal(record.recipients.filter(r=>r.status==='accepted').length,1,'Repeated acceptance is idempotent');
  assert.match(await confirm(third,'decline'),/will not receive/);
  db=store();commands=new ReminderCommands(db,()=>({reminderTimeZone:'UTC'}));record=db.reminders[0];
  assert.equal(record.recipients[0].status,'accepted','Consent survives service restarts');
  now=record.dueAt+1;await db.processDue(client);
  assert.deepEqual(delivered.map(r=>r.id),[other]); assert.equal(db.reminders.length,0);
  delivered.length=0;

  request=interaction({notify:[{id:user},{id:other},{id:third}]});await commands.create(request);record=db.reminders[0];id=record.id;
  await confirm(other); blocked.add(other);
  now=record.dueAt+1;await db.processDue(client);
  assert.deepEqual(delivered.map(r=>r.id),[user]);
  assert.equal(record.recipients.find(r=>r.userId===third).status,'expired','Unaccepted selections never receive a DM');
  assert.equal(record.recipients.find(r=>r.userId===other).attempts,1);
  await db.processDue(client); assert.equal(record.recipients.find(r=>r.userId===other).attempts,1,'Retries honor their delay');
  now+=60001;await db.processDue(client);now+=60001;await db.processDue(client);
  assert.equal(db.reminders.length,0); assert.equal(delivered.length,1,'Failed recipients never duplicate successful deliveries');blocked.clear();

  request=interaction({notify:[{id:user},{id:other}]});await commands.create(request);record=db.reminders[0];id=record.id;
  assert.match(await confirm(user,'cancel'),/cancelled for everyone/);assert.equal(db.reminders.length,0);
  assert.match(await confirm(other),/no longer active/);
  request=interaction({notify:[{id:other,bot:true}]});await commands.create(request);assert.equal(db.reminders.length,0);assert.match(request.replies[0].content,/not bot accounts/);
  request=interaction({when:'garbage',notify:[{id:other}]});await commands.create(request);assert.equal(db.reminders.length,0);assert.match(request.replies.at(-1),/could not understand/);
  request=interaction({message:'   '});await commands.create(request);assert.equal(db.reminders.length,0);
  // Cancellation while Discord's user lookup is in flight stops subsequent sends.
  request=interaction({notify:[{id:user}]});await commands.create(request);record=db.reminders[0];
  now=record.dueAt+1;
  let releaseFetch;
  const paused={users:{fetch:()=>new Promise(resolve=>{releaseFetch=resolve;})}};
  const processing=db.processDue(paused);
  db.cancelGroup(record,user);
  releaseFetch({id:user,send:async()=>{throw Error('Cancelled reminder must not be sent');}});
  await processing;assert.equal(db.reminders.length,0);
  const events=fs.readFileSync(path.join(root,'reminder-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const event of ['created','accepted','declined','delivered','delivery_retry','delivery_failed','acceptance_expired','cancelled'])assert.ok(events.some(r=>r.event===event),event);
  assert.ok(events.every(r=>!Object.hasOwn(r,'text')&&!Object.hasOwn(r,'token')),'Activity logs omit reminder content and interaction tokens');
  console.log('Group-DM command contexts, recipient selection/consent/isolation, legacy reminders, restart persistence, expiration, independent retries, cancellation, time parsing, and private activity logs passed.');
})().finally(()=>{Date.now=realNow;}).catch(error=>{console.error(error);process.exitCode=1;});
