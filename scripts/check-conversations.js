const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { KnowledgeBase } = require('../src/knowledge');
const { conversationContext } = require('../src/knowledge-conversations');
const { searchKnowledge } = require('../src/knowledge-search');
const { matchingAssociations } = require('../shared/search-associations.mjs');
const { inspectEvidenceReview } = require('../src/knowledge-policy');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'smartbot-conversation-test-'));
const guildId='100000000000000001', channelId='100000000000000002', person='100000000000000003';
const association={id:'alex',name:'Alex',aliases:['Lex'],related:['viewers'],userId:person,context:'Creator and their audience'};
const settings={get:()=>({knowledgeChannelIds:[channelId], searchAssociations:[association]})};
const store=new KnowledgeBase({dataDirectory:directory},settings);
const add=(id,content,time,authorId,replyToId=null,channel=channelId)=>store.store({id,guildId,channelId:channel,rootId:channel,channelName:'discussion',content,createdTimestamp:time,authorId,replyToId});
const group=id=>store.groups.forMessage({id,guildId,channelId});
async function run(){
  add('101','anyone know what lex likes eating',100000,person);
  add('102','checking now',110000,'helper');
  add('103','his favorite is beans',120000,'respondent');
  add('104','the camera battery is dead',10000000,'other');
  add('105','beans',20000000,'respondent','101');
  add('106','unrelated private context',110000,'private',null,'private');
  const nearby=conversationContext(store,group('101'));
  assert.ok(nearby.messages.some(m=>m.id==='103'),'Two-message distance without a question mark is retained');
  assert.ok(nearby.messages.some(m=>m.id==='105'),'Explicit replies survive long time gaps');
  assert.ok(!nearby.messages.some(m=>['104','106'].includes(m.id)),'Adjacency stops at long gaps and channel boundaries');
  assert.ok(conversationContext(store,group('105')).messages.some(m=>m.id==='101'),'Answer expands back to question');
  assert.equal(matchingAssociations([association],'lex likes food').length,1);
  assert.equal(matchingAssociations([association],'complex food').length,0,'Aliases match whole names, not substrings');
  assert.equal(store.groups.search('eating',['eating'],guildId,[channelId],{authorId:person}).matches[0].message.id,'101');
  const access={safeRoots:new Set([channelId]),allowedIds:[channelId],guild:{channels:{cache:new Map()}},destination:{name:'discussion',isThread:()=>false}};
  let mode='nearby';
  const retrieval={store,indexer:{credentials:()=>({provider:'openai',apiKey:'test'}),cooldowns:new Map([[guildId,Date.now()+100000]])},validate:async(_,__,sources)=>sources,ai:{generate:async args=>{
    if(args.textFormat.name==='knowledge_search_plan'){
      assert.equal(JSON.parse(args.conversation[0].text).searchAssociations[0].aliases[0],'Lex');
      return JSON.stringify({concepts:['food'],queries:[{query:'eating',channelIds:[],offset:0}]});
    }
    const data=JSON.parse(args.conversation[0].text);
    assert.ok(data.candidates.some(g=>g.messages.some(m=>m.id==='103')),'Short answer reaches reviewer before relevance filtering');
    assert.ok(data.conversationEdges.some(e=>e.to==='103'));
    // Tests the routing and preservation contract, not probabilistic model accuracy.
    return JSON.stringify({sufficient:true,explanation:'Answer understood with its question',selections:[{id:mode==='nearby'?'103':'105',reason:'The exchange resolves the pronoun',contextIds:mode==='nearby'?['101']:[]}],queries:[]});
  }}};
  let trace={};
  let sources=await searchKnowledge({retrieval,access,guildId,text:'what does lex like eating',recentQuestions:[],trace});
  assert.deepEqual(new Set(sources.map(m=>m.id)),new Set(['101','103']));
  assert.ok(trace.conversationPackets[0].selected);
  assert.ok(sources.find(m=>m.id==='103').contextGroupIds.includes('101'));
  mode='reply'; trace={};
  sources=await searchKnowledge({retrieval,access,guildId,text:'food',recentQuestions:[],trace});
  assert.deepEqual(new Set(sources.map(m=>m.id)),new Set(['101','105']),'Direct reply retains parent even when model omits context IDs');
  // A live deletion of essential context rejects the entire dependent answer.
  retrieval.validateGroups=async(_,__,groups,options)=>options?.refreshMessages===false?groups:groups.filter(g=>g.id!=='101');
  trace={}; sources=await searchKnowledge({retrieval,access,guildId,text:'food',recentQuestions:[],trace});
  assert.equal(sources.length,0);
  assert.equal(trace.conversationPackets[0].reason,'context_unavailable');
  const result=inspectEvidenceReview({kind:'grounded',supported:true,answer:'They answered no. [S1]',evidence:[{id:'S1',quote:'no'}]},[{id:'S1',content:'no'}],{requireCitations:true,citationCount:1});
  assert.ok(result.answer,'Whole short answers can support evidence');
  console.log('Conversation adjacency, informal anchors, direct replies, name matching, author search, context preservation, deletion rejection and short quotes passed.');
}
run().finally(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});}).catch(error=>{console.error(error);process.exitCode=1;});
