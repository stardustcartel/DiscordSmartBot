const { terms } = require('./knowledge');
const lookupSchema = {
  type:'object', additionalProperties:false,
  properties:{ mode:{type:'string',enum:['topic','latest','earliest','range']}, authorRequired:{type:'boolean'}, authorIds:{type:'array',items:{type:'string'}}, channelIds:{type:'array',items:{type:'string'}}, start:{type:'string'}, end:{type:'string'}, topicQueries:{type:'array',items:{type:'string'}}, limit:{type:'integer'} },
  required:['mode','authorRequired','authorIds','channelIds','start','end','topicQueries','limit'],
};
function normalizeLookup(value, authorIds, channels) {
  if (!value || value.mode === 'topic') return null;
  if (!['latest','earliest','range'].includes(value.mode)) throw Error('Invalid lookup mode');
  if(typeof value.authorRequired!=='boolean' || !Array.isArray(value.authorIds) || !Array.isArray(value.channelIds) || !Array.isArray(value.topicQueries)) throw Error('Invalid lookup filters');
  const authors=Array.isArray(value.authorIds) ? [...new Set(value.authorIds)] : [];
  if (authors.some(id=>!authorIds.includes(id)) || (value.authorRequired && authors.length!==1)) throw Error('Requested author could not be unambiguously resolved');
  const selected=Array.isArray(value.channelIds) ? value.channelIds : [];
  if(selected.some(id=>!channels.includes(id))) throw Error('Unknown or inaccessible channel filter');
  const date=s=>{
    if(!s) return null;
    if(typeof s!=='string' || !/(Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s))) throw Error('Invalid date boundary');
    return Date.parse(s);
  };
  const start=date(value.start), end=date(value.end);
  if(start!==null && end!==null && start>=end) throw Error('Invalid date range');
  if(value.mode==='range' && start===null && end===null) throw Error('Date range missing');
  const topicQueries=(Array.isArray(value.topicQueries)?value.topicQueries:[]).filter(q=>typeof q==='string').slice(0,8).map(q=>terms(q).slice(0,8)).filter(q=>q.length);
  if(value.topicQueries.length && !topicQueries.length) throw Error('Invalid topic filter');
  return {mode:value.mode,authorIds:authors,channelIds:selected,start,end,topicQueries,limit:Math.max(1,Math.min(24,Number.isInteger(value.limit)?value.limit:1))};
}
async function lookupMessages({retrieval,client,access,guildId,messageId,lookup,trace}) {
  trace.retrievalUnit='chronologically_ordered_message';
  const {store}=retrieval;
  const selectedRoots=store.guildSettings.get(guildId).knowledgeChannelIds || [];
  const conditions=['guildId=?','channelId IN (SELECT value FROM json_each(?))','rootId IN (SELECT value FROM json_each(?))','id<>?'];
  const args=[guildId,JSON.stringify(access.allowedIds),JSON.stringify(selectedRoots),messageId || ''];
  if(lookup.authorIds.length){conditions.push('authorId IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(lookup.authorIds));}
  if(lookup.channelIds.length){conditions.push('(channelId IN (SELECT value FROM json_each(?)) OR rootId IN (SELECT value FROM json_each(?)))');args.push(JSON.stringify(lookup.channelIds),JSON.stringify(lookup.channelIds));}
  if(lookup.start!==null){conditions.push('createdTimestamp>=?');args.push(lookup.start);}
  if(lookup.end!==null){conditions.push('createdTimestamp<?');args.push(lookup.end);}
  // Bound parameters only. Topic alternatives are OR branches, words within each branch are ANDed.
  if(lookup.topicQueries.length) conditions.push('('+lookup.topicQueries.map(tokens=>'('+tokens.map(token=>{args.push(token.toLowerCase());return 'instr(lower(content),?)>0';}).join(' AND ')+')').join(' OR ')+')');
  const direction=lookup.mode==='earliest' || lookup.mode==='range' ? 'ASC' : 'DESC';
  const where=conditions.join(' AND ');
  const total=store.db.prepare('SELECT count(*) AS n FROM messages WHERE '+where).get(...args).n;
  const rows=store.db.prepare(`SELECT * FROM messages WHERE ${where} ORDER BY createdTimestamp ${direction},length(id) ${direction},id ${direction} LIMIT 72`).all(...args);
  const log=trace.structuredLookup={...lookup,status:'started',totalIndexedMatches:total,candidateIds:rows.map(m=>m.id),rejectedIds:[],selectedIds:[],coverage:'Selected, indexed Discord channels readable in this conversation only; not a server-wide completeness guarantee.',topicCoverage:lookup.topicQueries.length ? 'Keyword alternatives; not exhaustive semantic topic coverage.' : null};
  const chosen=[];
  for(let i=0;i<rows.length && chosen.length<lookup.limit;i+=6){
    const batch=rows.slice(i,i+6);
    const live=await retrieval.validate(client,access,batch);
    const byId=new Map(live.map(m=>[m.id,m]));
    for(const row of batch){
      const current=byId.get(row.id);
      const topicMatches=current && (!lookup.topicQueries.length || lookup.topicQueries.some(tokens=>tokens.every(t=>current.content.toLowerCase().includes(t.toLowerCase()))));
      if(!topicMatches){log.rejectedIds.push(row.id);continue;}
      if(chosen.length<lookup.limit) chosen.push(current);
    }
  }
  log.selectedIds=chosen.map(m=>m.id);
  log.status='complete'; log.truncated=total>chosen.length+log.rejectedIds.length;
  log.validationLimited=rows.length===72 && chosen.length<lookup.limit;
  trace.selectedMessageIds=log.selectedIds;
  trace.searchOutcome=chosen.length?'structured_lookup_selected':'structured_lookup_no_verified_matches';
  return chosen;
}
module.exports={lookupSchema,normalizeLookup,lookupMessages};
