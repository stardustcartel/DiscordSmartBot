import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {zipSync,strToU8} from 'fflate';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {filesSchema,saveFile,fileMeta,removeFile,sha256} from '../functions/_lib/files.js';
import {syncDrive,googleAccountEmail} from '../functions/_lib/google-drive.js';
import {cite} from '../src/knowledge-retrieval.js';
import {encryptGuildKey} from '../functions/_lib/gemini-secret.js';
import {onRequestPost as internalFiles} from '../functions/api/internal/files/[guildId].js';
import {onRequestPost as dashboardFiles} from '../functions/api/guild/[guildId]/files.js';
import {seal} from '../functions/_lib/auth.js';
import {FilesKnowledge,sections} from '../src/files-knowledge.js';
const database=new DatabaseSync(':memory:');
const db={prepare(sql){return {bind(...values){const statement=database.prepare(sql);return {run:async()=>({meta:statement.run(...values)}),first:async()=>statement.get(...values),all:async()=>({results:statement.all(...values)})};},run:async()=>({meta:database.prepare(sql).run()}),first:async()=>database.prepare(sql).get(),all:async()=>({results:database.prepare(sql).all()})};},async batch(statements){for(const statement of statements)await statement.run();}};
const objects=new Map();
const env={DB:db,KNOWLEDGE_FILES:{async put(key,value){objects.set(key,value);},async get(key){const value=objects.get(key);return value==null?null:{body:new Response(value).body};},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}}};
const a='1218340601968197712',b='1545533279766319215',bytes=new TextEncoder().encode('Creator transcript. A direct answer appears here.');
await filesSchema(db);
await filesSchema(db); // Existing installations can repeat schema setup safely.
const documentSources=[{sourceType:'file',title:'private.txt'}, {sourceType:'file',url:'https://drive.google.com/open?id=private',title:'Drive transcript'}, {url:'https://discord.com/channels/1/2/3'}];
const cited=cite('First fact [S1]. Another fact [S2]. Server fact [S3].',documentSources);
assert.ok(!cited.includes('private.txt') && !cited.includes('drive.google.com'));
assert.equal((cited.match(/documents added to our knowledge base/g)||[]).length,1,'document notice appears once even for multiple file sources');
assert.ok(cited.includes('[source 3](https://discord.com/channels/1/2/3)'));
assert.equal(cite('No document citation.',documentSources),'No document citation.');
const saved=await saveFile(env,a,{name:'Meeting.txt',description:'Q&A transcript',actorId:'1079143480988799046'},bytes);
assert.equal((await fileMeta(env,a)).files.length,1);
assert.equal((await fileMeta(env,b)).files.length,0);
assert.equal((await fileMeta(env,a)).files[0].sha256,await sha256(bytes));
await assert.rejects(saveFile(env,b,{id:saved.id,name:'attempt.txt'},bytes),/Storage limit/);
assert.equal((await fileMeta(env,b)).files.length,0);
await removeFile(env,(await fileMeta(env,a)).files[0],'test');
assert.equal((await fileMeta(env,a)).files.length,0);
env.BOT_SYNC_SECRET='test-secret';
const endpoint='https://example.test/api/internal/files/'+b;
const denied=await internalFiles({env,request:new Request(endpoint,{method:'POST',body:JSON.stringify({action:'meta'})}),params:{guildId:b}});
assert.equal(denied.status,401);
const tokenKey=Buffer.alloc(32,7).toString('base64');env.GUILD_SECRETS_KEY=tokenKey;
const testToken={access_token:'test-only',refresh_token:'test-refresh',expires_in:3600};
await db.prepare('INSERT INTO google_connections(guild_id,generation,name,token_json,expires_at,folders_json,connected_by,connected_at) VALUES (?,?,?,?,?,?,?,?)').bind(b,'gen-test','Test Google',JSON.stringify(await encryptGuildKey(JSON.stringify(testToken),tokenKey)),Date.now()+3600000,JSON.stringify([{id:'folder-test',name:'Q&A'}]),'user',Date.now()).run();
const originalFetch=globalThis.fetch;
env.DASHBOARD_SESSION_SECRET='fixture-session-secret';env.DISCORD_BOT_TOKEN='fixture-bot-token';
const owner='1079143480988799046';
const session=await seal({user:{id:owner},guilds:[{id:b}],expiresAt:Date.now()+60000},env.DASHBOARD_SESSION_SECRET);
const folderRequest=(folderId,authenticated=true)=>new Request('https://example.test/api/guild/'+b+'/files',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',...(authenticated?{Cookie:'dashboard_session='+session}:{})},body:JSON.stringify({action:'validateFolder',folderId})});
globalThis.fetch=async input=>{
  const url=new URL(input);
  if(url.hostname==='discord.com')return Response.json(url.pathname.endsWith('/roles')?[]:url.pathname.includes('/members/')?{roles:[]}:{owner_id:owner});
  const id=url.pathname.split('/').at(-1);
  if(id==='missing')return Response.json({error:'Not found'},{status:404});
  return Response.json({id,name:'Q&A folder',mimeType:id==='file'?'text/plain':'application/vnd.google-apps.folder',trashed:id==='trashed'});
};
try {
  const call=(id,auth=true)=>dashboardFiles({env,request:folderRequest(id,auth),params:{guildId:b}});
  assert.equal((await call('folder',false)).status,403);
  for(const id of ['file','trashed','bad/id'])assert.equal((await call(id)).status,400);
  assert.equal((await call('missing')).status,404);
  assert.deepEqual(await (await call('folder')).json(),{folder:{id:'folder',name:'Q&A folder'}});
  assert.deepEqual(JSON.parse((await db.prepare('SELECT folders_json FROM google_connections WHERE guild_id=?').bind(b).first()).folders_json),[{id:'folder-test',name:'Q&A'}],'validation must not commit a folder selection');
  for(const description of ['', '   ']) {
    const form=new FormData();form.append('file',new File([bytes],'transcript.txt',{type:'text/plain'}));form.append('description',description);
    const request=new Request('https://example.test/api/guild/'+b+'/files',{method:'POST',headers:{Origin:'https://example.test',Cookie:'dashboard_session='+session},body:form});
    const response=await dashboardFiles({env,request,params:{guildId:b}});
    assert.equal(response.status,400,'uploads without a nonblank description must be rejected');
  }
  assert.equal((await fileMeta(env,b)).files.length,0,'rejected uploads must not be stored');
} finally {globalThis.fetch=originalFetch;}
let identityReads=0;
globalThis.fetch=async()=>{identityReads++;return Response.json({user:{emailAddress:'test@example.test'}});};
try {
  assert.equal(await googleAccountEmail(env,await db.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(b).first()),'test@example.test');
  assert.equal(await googleAccountEmail(env,await db.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(b).first()),'test@example.test');
  assert.equal(identityReads,1,'existing accounts fetch their email once and then reuse storage');
} finally {globalThis.fetch=originalFetch;}
globalThis.fetch=async input=>{const url=new URL(input);
  if(url.pathname.endsWith('/files') && url.searchParams.has('q'))return Response.json({files:[{id:'document-test',name:'Drive.txt',mimeType:'text/plain',size:String(bytes.length),modifiedTime:'2026-10-20T00:00:00Z',parents:['folder-test']}],nextPageToken:null});
  if(url.pathname.endsWith('/files/document-test') && url.searchParams.get('alt')==='media')return new Response(bytes);
  throw Error('Unexpected Google request in fixture: '+url.pathname);
};
try {await syncDrive(env,b);} finally {globalThis.fetch=originalFetch;}
assert.equal((await fileMeta(env,b)).files.length,1,'private Drive folder must import its document');
assert.equal((await fileMeta(env,a)).files.length,0,'Drive import must stay in its server');
const driveFile=(await fileMeta(env,b)).files[0];
const fetched=await internalFiles({env,request:new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer test-secret'},body:JSON.stringify({action:'original',id:driveFile.id,revision:driveFile.revision})}),params:{guildId:b}});
assert.equal(fetched.status,200);
assert.equal(new TextDecoder().decode(await fetched.arrayBuffer()),new TextDecoder().decode(bytes));
const wrongServer=await internalFiles({env,request:new Request(endpoint.replace(b,a),{method:'POST',headers:{Authorization:'Bearer test-secret'},body:JSON.stringify({action:'original',id:driveFile.id})}),params:{guildId:a}});
assert.equal(wrongServer.status,409);
assert.ok(sections('Question: Where is the asset library?\nAnswer: In Patreon Collections.').some(x=>x.includes('Patreon Collections')));
const docx=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>Creator asset library</w:t></w:r></w:p><w:p><w:r><w:t>Patreon Collections</w:t></w:r></w:p></w:body></w:document>')});
const extracted=spawnSync(process.execPath,['src/file-extract-worker.js','docx'],{input:docx,encoding:'utf8'});
assert.equal(extracted.status,0,extracted.stderr);
assert.match(extracted.stdout,/Creator asset library/);
assert.match(extracted.stdout,/Patreon Collections/);
const workbook=zipSync({
  'xl/workbook.xml':strToU8('<workbook><sheets><sheet name="Q&amp;A"/></sheets></workbook>'),
  'xl/sharedStrings.xml':strToU8('<sst><si><t>Question</t></si><si><t>Answer</t></si><si><t>Patreon Collections</t></si></sst>'),
  'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="B2" t="s"><v>2</v></c></row></sheetData></worksheet>')
});
const sheet=spawnSync(process.execPath,['src/file-extract-worker.js','xlsx'],{input:workbook,encoding:'utf8'});
assert.equal(sheet.status,0,sheet.stderr);
assert.match(sheet.stdout,/Sheet: Q&A/);
assert.match(sheet.stdout,/B2: Patreon Collections/);
function samplePdf(){
  const content='BT /F1 12 Tf 72 720 Td (Private Q and A transcript) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const pdf=spawnSync(process.execPath,['src/file-extract-worker.js','pdf'],{input:samplePdf(),encoding:'utf8'});
assert.equal(pdf.status,0,pdf.stderr);
assert.match(pdf.stdout,/Private Q and A transcript/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'smartbot-file-check-'));
try {
  const knowledgeDb=new DatabaseSync(':memory:');
  const store={db:knowledgeDb,transaction(fn){knowledgeDb.exec('BEGIN');try{fn();knowledgeDb.exec('COMMIT');}catch(error){knowledgeDb.exec('ROLLBACK');throw error;}}};
  const worker=new FilesKnowledge({dataDirectory:temp},store,{credentials:()=>({provider:'openai'})});
  worker.writeEvent=(_guild,event,detail)=>{if(event==='index_failed')throw Error(detail.reason);};
  const testFile={id:'fixture',kind:'upload',driveId:null,name:'Q-and-A.txt',description:'RCA session transcript',size:bytes.length,sha256:await sha256(bytes),revision:'revision1',state:'queued',objectKey:'knowledge/test/fixture',status:{}};
  worker.meta.set(a,{channelIds:[],files:[{...testFile,state:'ready'}]});
  worker.remote=async(_guild,body)=>body.action==='original'?Buffer.from(bytes):body.action==='validate'?{valid:true}:body.action==='failed'?Promise.reject(Error(body.warning)):{ok:true};
  await worker.ingest(a,testFile);
  assert.equal(knowledgeDb.prepare('SELECT count(*) n FROM imported_sections').get().n,1,'ingest must store a section');
  const found=await worker.search(a,{id:'1559282610063278270',isThread:()=>false},'direct answer transcript',{searchPlan:{queries:[]},embeddingSearch:{status:'skipped'}});
  assert.equal(found.length,1);
  assert.match(found[0].content,/direct answer/);
  assert.equal((await worker.validate(a,{id:'1559282610063278270',isThread:()=>false},found)).length,1);
  let validationRequests=0;
  worker.remote=async(_guild,body)=>{if(body.action==='validate'){validationRequests++;return{valid:true};}return{ok:true};};
  const sectionsFromSameFile=[found[0],{...found[0],part:1},{...found[0],part:2}];
  assert.equal((await worker.validate(a,{id:'1559282610063278270',isThread:()=>false},sectionsFromSameFile)).length,3);
  assert.equal(validationRequests,1,'Several sections of the same revision share one fresh visibility check');
  assert.equal((await worker.search(b,{id:'1559282610063278270',isThread:()=>false},'direct answer transcript',{searchPlan:{queries:[]}})).length,0);
  knowledgeDb.close();
} finally {fs.rmSync(temp,{recursive:true,force:true});}
database.close();
console.log('File quota, server isolation, deletion, private Drive import, internal authorization, DOCX/XLSX/PDF extraction, ingest, retrieval and validation passed.');
