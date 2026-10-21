const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { KnowledgeBase } = require('../src/knowledge');
const { loadThreadContext, ThreadResearch, ThreadQueue } = require('../src/thread-context');
const { searchKnowledge } = require('../src/knowledge-search');
const { evidenceInstructions, reviewInstructions, inspectEvidenceReview, effectivePolicy } = require('../src/knowledge-policy');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartbot-followups-'));
const guildId='100000000000000001', rootId='100000000000000002', threadId='100000000000000100';
let roots=[rootId];
const settings={get:()=>({knowledgeChannelIds:roots,approvedAnswers:[]})};
let store=new KnowledgeBase({dataDirectory:dir},settings);
const botId='900';
const message=(id,content,bot=false,reply=null)=>({id,guildId,channelId:threadId,content,createdTimestamp:Number(id.slice(-3)),author:{id:bot?botId:'member-'+id,bot},reference:reply?{messageId:reply}:null});
const opening=message(threadId,'What content should I make?');
const response=message('100000000000000110','Try game highlights.');response.author={id:botId,bot:true};
const second=message('100000000000000120','give me two more examples',false,response.id);
let sourceMessages=new Map([opening,response,second].map(m=>[m.id,m]));
const channel={id:threadId,guildId,parentId:rootId,type:11,name:'Choosing a niche',isThread:()=>true,permissionsFor:()=>({has:()=>true}),guild:{members:{fetch:async()=>({id:'member'}),fetchMe:async()=>({id:botId})}},messages:{fetch:async options=>{
  if(options.message){const m=sourceMessages.get(options.message);if(!m)throw Error('deleted');return m;}
  return new Map([...sourceMessages].filter(([id])=>!options.before || BigInt(id)<BigInt(options.before)));
}}};
const client={user:{id:botId}};
const access={guild:{id:guildId,channels:{cache:new Map()}},destination:channel,safeRoots:new Set([rootId]),allowedIds:[rootId]};
async function main(){
  const conversation=await loadThreadContext({client,channel,userId:'second-person',messageId:second.id});
  assert.deepEqual(conversation.messages.map(m=>m.id),[opening.id,response.id]);
  assert.equal(conversation.messages[1].role,'assistant');
  assert.equal(conversation.messages[0].authorId,opening.author.id,'Preserve different participants');
  sourceMessages.delete(response.id);
  const deleted=await loadThreadContext({client,channel,userId:'second-person',messageId:second.id});
  assert.ok(!deleted.messages.some(m=>m.id===response.id),'Deleted answers are not retained');
  assert.equal(deleted.omitted,true);
  channel.permissionsFor=()=>({has:()=>false});
  assert.deepEqual((await loadThreadContext({client,channel,userId:'denied',messageId:second.id})).messages,[]);
  channel.permissionsFor=()=>({has:()=>true});
  for(let i=101;i<151;i++){const id='100000000000000'+i;sourceMessages.set(id,message(id,'x'.repeat(5000)));}
  const bounded=await loadThreadContext({client,channel,userId:'member'});
  assert.ok(bounded.characters<=12000 && bounded.messages.length<=16 && bounded.omitted);

  let research=new ThreadResearch(store);
  research.save(access,{groups:[{id:'501',channelId:rootId}],searches:[],external:[]});
  store.close();store=new KnowledgeBase({dataDirectory:dir},settings);research=new ThreadResearch(store);
  assert.equal(research.load(access).groups[0].id,'501','Reuse survives process restart');
  assert.equal(research.load({...access,guild:{...access.guild,id:'other'}}),null,'Server isolation');
  assert.equal(research.load({...access,allowedIds:[]}),null,'Access changes invalidate research');
  roots=[];assert.equal(research.load(access),null);roots=[rootId];
  assert.equal(research.load(access),null,'Disabling indexing removes research');
  const queue=new ThreadQueue(), order=[];
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const first=queue.run(channel,async()=>{order.push(1);await waiting;order.push(2);});
  const next=queue.run(channel,async()=>{order.push(3);});
  await Promise.resolve();release();await Promise.all([first,next]);assert.deepEqual(order,[1,2,3]);
  await queue.run(channel,async()=>{throw Error('expected');}).catch(()=>{});
  await queue.run(channel,async()=>order.push(4));assert.equal(order.at(-1),4);

  const add=(id,content)=>store.store({id,guildId,channelId:rootId,rootId,channelName:'sports',authorId:'creator',createdTimestamp:Number(id)*100000,content});
  add('501','Sports game highlights and sports commentary are formats I have tried.');
  add('502','Equipment for sports channels: use clear audio and consistent lighting.');
  let mode='reuse',calls=[];
  const retrieval={store,indexer:{credentials:()=>({provider:'openai',apiKey:'not-a-real-key'}),cooldowns:new Map([[guildId,Date.now()+1000000]])},validate:async(_,__,sources)=>sources,
    ai:{generate:async args=>{
      calls.push(args.textFormat.name);
      const input=JSON.parse(args.conversation[0].text);
      assert.ok(input.threadConversation.messages.some(m=>m.role==='assistant'));
      if(args.textFormat.name==='knowledge_search_plan')return JSON.stringify({concepts:['sports'],queries:mode==='mixed'?[{query:'equipment',channelIds:[],offset:0}]:[],expansions:[],followup:{resolvedQuestion:mode==='mixed'?'Additional sports formats and sports equipment':'Additional sports formats',reuseIds:['501','invented'],searchNeeded:mode==='mixed',reason:'Continue the discussion',missing:mode==='mixed'?['equipment']:[],alreadySuggested:['highlights']}});
      if(mode==='missing' && input.round===1)return JSON.stringify({sufficient:false,explanation:'Only one unused example, need another',selections:[{id:'501',reason:'Contains unused commentary',contextIds:[]}],queries:[{query:'other sports formats',channelIds:[],offset:0}]});
      return JSON.stringify({sufficient:mode!=='missing',explanation:mode==='missing'?'Only one additional example supported':'Enough for this request',selections:[{id:'501',reason:'Commentary is unused even though highlights came from this source',contextIds:[]},...(mode==='mixed'?[{id:'502',reason:'New equipment question',contextIds:[]}]:[])],queries:[]});
    }}};
  const run=async()=>{calls=[];const trace={};const cachedGroups=[store.groups.forMessage({id:'501',guildId,channelId:rootId})].filter(Boolean);const sources=await searchKnowledge({retrieval,client,access,guildId,text:mode==='mixed'?'give me another example and what equipment do I need':'give me more examples',messageId:second.id,recentQuestions:[],trace,threadConversation:conversation,cachedGroups,research:{searches:[{query:'sports',offset:0}]}});return {sources,trace};};
  let result=await run();
  assert.ok(result.sources.some(s=>s.id==='501'));
  assert.deepEqual(result.trace.followup.reuseIds,['501'],'Reject invented reuse IDs');
  assert.equal(result.trace.searchRounds[0].searches.length,0,'Sufficient cached evidence skips archive search');
  assert.equal(result.trace.embeddingSearch.status,'skipped','No repeated embedding request for sufficient cache');
  assert.deepEqual(calls,['knowledge_search_plan','knowledge_search_review'],'No added AI round for reuse');
  mode='mixed';result=await run();
  assert.ok(result.sources.some(s=>s.id==='501') && result.sources.some(s=>s.id==='502'));
  assert.ok(result.trace.searchRounds[0].searches.some(s=>s.query==='equipment'));
  mode='missing';result=await run();
  assert.equal(result.trace.searchRounds.length,2,'Missing examples trigger a bounded targeted search');
  assert.equal(result.trace.stopReason,'bounded_search_complete');
  assert.ok(result.sources.some(s=>s.id==='501'),'Retain partial evidence rather than inventing examples');
  store.remove({id:'501'});assert.equal(store.groups.forMessage({id:'501',guildId,channelId:rootId}),null);
  for(const knowledgeOnly of [true,false])for(const requireCitations of [true,false]){
    const policy={knowledgeOnly,requireCitations,citationCount:2};
    assert.match(evidenceInstructions(policy),/latest user message/);
    assert.match(reviewInstructions(policy,'Be friendly',''),/latest user message/);
    const general=inspectEvidenceReview({kind:'general',supported:true,answer:'General suggestion',evidence:[]},[],policy);
    assert.equal(Boolean(general.answer),!knowledgeOnly,'Existing policy still governs follow-ups');
  }
  const policy=effectivePolicy({knowledgeOnly:true,requireCitations:true,generalChannels:[rootId],uncitedChannels:[]},channel);
  assert.equal(policy.knowledgeOnly,false);assert.equal(policy.requireCitations,true,'Forum knowledge exemption does not disable required citations');
  const uncited=effectivePolicy({knowledgeOnly:true,requireCitations:true,generalChannels:[],uncitedChannels:[rootId]},channel);
  assert.equal(uncited.knowledgeOnly,true);assert.equal(uncited.requireCitations,false,'Citation exemption does not disable grounding');
  console.log('Thread history, authors, edits/deletions, access, context budgets, restart reuse, server isolation, queue ordering, cached examples, mixed requests, bounded missing-evidence searches and policy enforcement passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
