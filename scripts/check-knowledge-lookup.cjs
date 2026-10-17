const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {normalizeLookup,lookupMessages}=require('../src/knowledge-lookup');
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE messages(id TEXT,guildId TEXT,channelId TEXT,rootId TEXT,authorId TEXT,createdTimestamp INTEGER,content TEXT)');
for(const row of [
 ['1','g','c','c','a',1000,'A detailed older statement'],
 ['2','g','c','c','a',2000,'hi'],
 ['3','g','c','c','b',3000,'mentioning a does not mean authored by a'],
 ['4','other','c','c','a',4000,'other guild'],
 ['5','g','private','private','a',5000,'private'],
 ['6','g','c','c','a',6000,'a deleted message'],
 ['7','g','thread','forum','a',2500,'acoustic treatment works'],
 ['8','g','unselected','unselected','a',8000,'unselected source'],
 ])db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(...row);
const base={mode:'latest',authorRequired:true,authorIds:['a'],channelIds:[],start:'',end:'',topicQueries:[],limit:1};
const retrieval={store:{db,guildSettings:{get:()=>({knowledgeChannelIds:['c','forum']})}},validate:async(_,__,rows)=>rows.filter(m=>m.id!=='6')};
async function run(plan,overrides={}){const trace={};const lookup=normalizeLookup({...base,...plan},['a','b'],['c','thread','forum']);const result=await lookupMessages({retrieval,access:{allowedIds:['c','thread','unselected']},guildId:'g',lookup,trace,...overrides});return {result,trace};}
(async()=>{
 assert.throws(()=>normalizeLookup({...base,authorIds:['invented']},['a'],['c']));
 assert.throws(()=>normalizeLookup({...base,authorIds:[]},['a'],['c']));
 assert.throws(()=>normalizeLookup({...base,channelIds:['private']},['a'],['c']));
 assert.throws(()=>normalizeLookup({...base,start:'yesterday'},['a'],['c']));
 assert.throws(()=>normalizeLookup({...base,mode:'range'},['a'],['c']));
 assert.equal(normalizeLookup({mode:'topic'},[],[]),null);
 assert.equal((await run({})).result[0].id,'7','Forum messages participate in timestamp ordering');
 const short=await run({channelIds:['c']});assert.equal(short.result[0].id,'2','Short messages survive relevance filtering');assert.deepEqual(short.trace.structuredLookup.rejectedIds,['6']);
 assert.equal((await run({mode:'earliest'})).result[0].id,'1');
 assert.equal((await run({topicQueries:['acoustic treatment']})).result[0].id,'7');
 await assert.rejects(run({topicQueries:["' OR 1=1 --"]}),/Invalid topic filter/);
 assert.equal((await run({topicQueries:["nonexistent' UNION SELECT content"]})).result.length,0,'SQL remains parameterized');
 assert.equal((await run({channelIds:['forum']})).result[0].id,'7');
 assert.equal((await run({mode:'range',start:'1970-01-01T00:00:02Z',end:'1970-01-01T00:00:02.500Z',limit:24})).result[0].id,'2','Inclusive start and exclusive end');
 assert.equal((await run({}, {messageId:'7'})).result[0].id,'2','Exclude current prompt');
 assert.equal((await run({authorRequired:false,authorIds:[]})).result[0].id,'3','Any-author latest respects scope');
 const {searchKnowledge}=require('../src/knowledge-search');
 retrieval.indexer={credentials:()=>({provider:'openai'}),cooldowns:new Map()};
 let calls=0;
 retrieval.ai={generate:async()=>{calls++;return JSON.stringify({concepts:[],queries:[],expansions:[],lookup:{...base,authorRequired:false,authorIds:[]}});}};
 const access={allowedIds:['c','thread'],safeRoots:new Set(['c','forum']),guild:{channels:{cache:new Map()}},destination:{name:'help',isThread:()=>false}};
 const trace={};
 const routed=await searchKnowledge({retrieval,access,guildId:'g',text:'what was said last',recentQuestions:[],trace});
 assert.equal(routed[0].id,'3');assert.equal(calls,1,'Metadata lookup bypasses semantic/relevance calls');
 assert.equal(trace.searchOutcome,'structured_lookup_selected');
 retrieval.ai.generate=async()=>JSON.stringify({queries:[],expansions:[],lookup:{...base,authorIds:[]}});
 const missing={};assert.deepEqual(await searchKnowledge({retrieval,access,guildId:'g',text:'what did someone say last',recentQuestions:[],trace:missing}),[]);
 assert.equal(missing.searchOutcome,'structured_lookup_needs_clarification');
 console.log('Structured lookup: identity, chronology, dates, forum scope, SQL safety, deletion fallback and short replies passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
