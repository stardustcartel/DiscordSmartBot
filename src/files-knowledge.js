const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {embed,modelFor}=require('./knowledge-embeddings');
const {terms}=require('./knowledge');
const digest=text=>createHash('sha256').update(text).digest('hex');
const allowed=(ids,channel)=>!ids.length || ids.includes(channel.id) || Boolean(channel.isThread?.() && ids.includes(channel.parentId));
function sections(text) {
  const lines=text.split(/\n/),out=[];let part='';
  for(const line of lines) {
    if(part && part.length+line.length>4200) {out.push(part.trim());part=part.slice(-450)+'\n';}
    if(line.length>4200) {for(let i=0;i<line.length;i+=3800) {if(part.trim()) {out.push(part.trim());part='';} out.push(line.slice(i,i+4000));} }
    else part+=line+'\n';
  }
  if(part.trim()) out.push(part.trim());
  return out.slice(0,220);
}
function extract(bytes,ext) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--max-old-space-size=192',path.join(__dirname,'file-extract-worker.js'),ext],{stdio:['pipe','pipe','pipe']});
    let output='',errors=''; const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
    child.stdout.on('data',part=>{output+=part.toString();if(output.length>800000) child.kill('SIGKILL');});
    child.stderr.on('data',part=>{errors=(errors+part.toString()).slice(0,500);});
    child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(errors || 'Document extraction timed out or exceeded resource limits.'));});
    child.stdin.end(bytes);
  });
}
class FilesKnowledge {
  constructor(config,store,indexer) {
    Object.assign(this,{config,store,indexer,db:store.db,meta:new Map(),running:false});
    this.root=path.join(config.dataDirectory,'files');
    this.db.exec(`CREATE TABLE IF NOT EXISTS imported_files (guildId TEXT NOT NULL,id TEXT NOT NULL,revision TEXT NOT NULL,sha256 TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,driveId TEXT,objectKey TEXT NOT NULL,PRIMARY KEY(guildId,id));
      CREATE TABLE IF NOT EXISTS imported_sections (guildId TEXT NOT NULL,fileId TEXT NOT NULL,part INTEGER NOT NULL,content TEXT NOT NULL,vector BLOB,vectorModel TEXT,PRIMARY KEY(guildId,fileId,part));
      CREATE VIRTUAL TABLE IF NOT EXISTS imported_search USING fts5(content,content='imported_sections',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS imported_ai AFTER INSERT ON imported_sections BEGIN INSERT INTO imported_search(rowid,content) VALUES(new.rowid,new.content); END;
      CREATE TRIGGER IF NOT EXISTS imported_ad AFTER DELETE ON imported_sections BEGIN INSERT INTO imported_search(imported_search,rowid,content) VALUES('delete',old.rowid,old.content); END;
      CREATE INDEX IF NOT EXISTS imported_scope ON imported_sections(guildId,vectorModel);`);
  }
  async remote(guildId,body,binary=false) {
    if(!this.config.dashboardSyncUrl || !this.config.botSyncSecret) return null;
    const response=await fetch(`${this.config.dashboardSyncUrl}/api/internal/files/${guildId}`,{method:'POST',headers:{Authorization:`Bearer ${this.config.botSyncSecret}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    if(!response.ok) {const data=await response.json().catch(()=>({}));throw Object.assign(Error(data.error || `File service returned HTTP ${response.status}.`),{status:response.status});}
    return binary?Buffer.from(await response.arrayBuffer()):response.json();
  }
  purge(guildId,id) {
    this.store.transaction(()=>{this.db.prepare('DELETE FROM imported_sections WHERE guildId=? AND fileId=?').run(guildId,id);this.db.prepare('DELETE FROM imported_files WHERE guildId=? AND id=?').run(guildId,id);});
  }
  writeEvent(guildId,event,detail={}) {
    try {
      const dir=path.join(this.root,guildId);fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const log=path.join(dir,'history.jsonl');fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),event,...detail})+'\n',{mode:0o600});
      if(fs.statSync(log).size>5*1024*1024) {fs.renameSync(log,path.join(dir,'history.previous.jsonl'));}
    } catch(error) {console.warn('File knowledge event not saved',{guildId,event,code:error.code});}
  }
  async tickGuild(guildId) {
    const meta=await this.remote(guildId,{action:'meta'});if(!meta) return;
    this.meta.set(guildId,meta);
    const active=new Set(meta.files.map(f=>f.id));
    for(const row of this.db.prepare('SELECT id FROM imported_files WHERE guildId=?').all(guildId)) if(!active.has(row.id)) {this.purge(guildId,row.id);this.writeEvent(guildId,'removed',{fileId:row.id});}
    for(const file of meta.files) this.db.prepare('UPDATE imported_files SET name=?,description=? WHERE guildId=? AND id=? AND revision=?').run(file.name,file.description,guildId,file.id,file.revision);
    // One original/extraction per pass, shared with normal Discord message work on the small VM.
    const pending=meta.files.find(f=>f.state==='queued' || (f.state==='ready' && this.db.prepare('SELECT revision FROM imported_files WHERE guildId=? AND id=?').get(guildId,f.id)?.revision!==f.revision));
    if(pending) await this.ingest(guildId,pending);
    const credentials=this.indexer.credentials(guildId),model=modelFor(credentials.provider);
    const rows=this.db.prepare('SELECT rowid,content FROM imported_sections WHERE guildId=? AND (vectorModel IS NULL OR vectorModel!=?) LIMIT 4').all(guildId,model);
    if(rows.length) {
      try {const vectors=await embed({...credentials,texts:rows.map(r=>r.content)});
        rows.forEach((row,i)=>this.db.prepare('UPDATE imported_sections SET vector=?,vectorModel=? WHERE rowid=? AND guildId=? AND content=?').run(Buffer.from(new Float32Array(vectors[i]).buffer),model,row.rowid,guildId,row.content));
        this.writeEvent(guildId,'semantic_indexed',{sections:rows.length,model});
      } catch(error) {this.writeEvent(guildId,'semantic_waiting',{reason:error.message.slice(0,180)});}
    }
    for(const file of meta.files.filter(f=>f.state==='ready')) {
      const progress=this.db.prepare('SELECT COUNT(*) total,SUM(CASE WHEN vectorModel=? THEN 1 ELSE 0 END) embedded FROM imported_sections WHERE guildId=? AND fileId=?').get(model,guildId,file.id);
      const current=file.status ? file.status : null;
      if(progress.total && (current?.semanticReady!==progress.embedded || current?.sections!==progress.total)) await this.remote(guildId,{action:'progress',id:file.id,revision:file.revision,total:progress.total,embedded:progress.embedded || 0}).catch(()=>{});
    }
  }
  async ingest(guildId,file) {
    const local=path.join(this.root,guildId,file.id,file.revision);
    this.writeEvent(guildId,'fetch_started',{fileId:file.id,revision:file.revision,objectKey:file.objectKey});
    try {
      const bytes=await this.remote(guildId,{action:'original',id:file.id,revision:file.revision},true);
      if(digest(bytes)!==file.sha256) throw Error('Original checksum mismatch.');
      const ext=file.name.split('.').at(-1).toLowerCase();
      const text=await extract(bytes,ext),parts=sections(text);
      if(!parts.length) throw Error('No usable text sections.');
      fs.mkdirSync(local,{recursive:true,mode:0o700});
      fs.writeFileSync(path.join(local,`original.${ext}`),bytes,{mode:0o600});
      fs.writeFileSync(path.join(local,'extracted.txt'),text,{mode:0o600});
      fs.writeFileSync(path.join(local,'manifest.json'),JSON.stringify({guildId,fileId:file.id,revision:file.revision,sha256:file.sha256,objectKey:file.objectKey,textSha256:digest(text),sections:parts.length,at:new Date().toISOString()}),{mode:0o600});
      this.store.transaction(()=>{
        this.db.prepare('DELETE FROM imported_sections WHERE guildId=? AND fileId=?').run(guildId,file.id);
        this.db.prepare('INSERT INTO imported_files VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(guildId,id) DO UPDATE SET revision=excluded.revision,sha256=excluded.sha256,name=excluded.name,description=excluded.description,kind=excluded.kind,driveId=excluded.driveId,objectKey=excluded.objectKey').run(guildId,file.id,file.revision,file.sha256,file.name,file.description,file.kind,file.driveId || null,file.objectKey);
        parts.forEach((content,part)=>this.db.prepare('INSERT INTO imported_sections(guildId,fileId,part,content) VALUES (?,?,?,?)').run(guildId,file.id,part,content));
      });
      await this.remote(guildId,{action:'indexed',id:file.id,revision:file.revision,text,sections:parts.length,textSha256:digest(text),localPath:local});
      this.writeEvent(guildId,'indexed',{fileId:file.id,revision:file.revision,sections:parts.length,localPath:local,textSha256:digest(text)});
    } catch(error) {
      await this.remote(guildId,{action:'failed',id:file.id,revision:file.revision,warning:error.message}).catch(()=>{});
      this.writeEvent(guildId,'index_failed',{fileId:file.id,revision:file.revision,reason:error.message.slice(0,300)});
    }
  }
  async tick(client) {
    for(const guildId of client.guilds.cache.keys()) {
      if(Date.now()<(this.cooldowns?.get(guildId)||0))continue;
      try {await this.remote(guildId,{action:'sync'});await this.tickGuild(guildId);}
      catch(error) {if(!this.cooldowns)this.cooldowns=new Map();this.cooldowns.set(guildId,Date.now()+(error.status===503?300000:60000));this.writeEvent(guildId,'sync_failed',{reason:error.message.slice(0,250)});}
    }
  }
  start(client) {if(this.running)return;this.running=true;this.busy=true;this.tick(client).catch(()=>{}).finally(()=>{this.busy=false;});this.timer=setInterval(()=>{if(!this.busy){this.busy=true;this.tick(client).catch(()=>{}).finally(()=>{this.busy=false;});}},30000);}
  stop(){this.running=false;clearInterval(this.timer);}
  has(guildId){return Boolean(this.meta.get(guildId)?.files.length);}
  async search(guildId,channel,text,trace) {
    const meta=this.meta.get(guildId);if(!meta || !allowed(meta.channelIds,channel)) return [];
    const candidates=new Map(),queries=[text,...(trace.searchPlan?.queries || []).map(x=>x.query)].slice(0,7);
    for(const query of queries) {
      const words=terms(query).slice(0,8);if(!words.length)continue;
      const fts=words.map(word=>`"${word.replace(/"/g,'')}"`).join(' OR ');
      try {for(const row of this.db.prepare(`SELECT s.fileId,s.part,s.content,f.name,f.description,f.kind,f.driveId,f.revision,f.sha256,bm25(imported_search) rank FROM imported_search JOIN imported_sections s ON s.rowid=imported_search.rowid JOIN imported_files f ON f.guildId=s.guildId AND f.id=s.fileId WHERE imported_search MATCH ? AND s.guildId=? LIMIT 30`).all(fts,guildId)) {
        const key=row.fileId+':'+row.part;candidates.set(key,{...row,score:(candidates.get(key)?.score||0)+Math.max(0.01,1/(10+Math.abs(row.rank)))});
      }} catch { /* Semantic search and other queries remain available. */ }
    }
    let vector=trace.embeddingSearch?.vector;
    if(!vector && trace.embeddingSearch?.status==='skipped' && meta.files.some(f=>f.state==='ready')) {
      try { [vector]=await embed({...this.indexer.credentials(guildId),texts:[`${channel.isThread?.()?channel.name:''} ${text}`.trim()],query:true});
        trace.fileQueryEmbedding={status:'ok',model:modelFor(this.indexer.credentials(guildId).provider),dimensions:vector.length};
      } catch(error) {trace.fileQueryEmbedding={status:'failed',reason:error.message.slice(0,160)};}
    }
    if(Array.isArray(vector) && vector.length===768) {
      const model=modelFor(this.indexer.credentials(guildId).provider);
      for(const row of this.db.prepare('SELECT s.fileId,s.part,s.content,s.vector,f.name,f.description,f.kind,f.driveId,f.revision,f.sha256 FROM imported_sections s JOIN imported_files f ON f.guildId=s.guildId AND f.id=s.fileId WHERE s.guildId=? AND s.vectorModel=?').iterate(guildId,model)) {
        const stored=new Float32Array(Uint8Array.from(row.vector).buffer);let score=0;for(let i=0;i<768;i++)score+=stored[i]*vector[i];
        if(score>.27){const key=row.fileId+':'+row.part;const {vector:omitted,...source}=row;candidates.set(key,{...source,score:(candidates.get(key)?.score||0)+score});}
      }
    }
    const active=new Map(meta.files.filter(f=>f.state==='ready').map(f=>[f.id,f]));
    const matches=[...candidates.values()].filter(row=>active.get(row.fileId)?.revision===row.revision).sort((a,b)=>b.score-a.score).slice(0,3).map(row=>({id:`${row.fileId}:${row.part}`,sourceType:'file',fileId:row.fileId,part:row.part,title:row.name,description:row.description,content:row.content,kind:row.kind,driveId:row.driveId,revision:row.revision,sha256:row.sha256,url:row.kind==='google'?`https://drive.google.com/open?id=${encodeURIComponent(row.driveId)}`:null}));
    trace.files={searched:true,queries,candidates:candidates.size,selected:matches.map(x=>({id:x.id,name:x.title,part:x.part,content:x.content,revision:x.revision}))};
    return matches;
  }
  async validate(guildId,channel,sources) {
    if(!sources.length)return [];
    const meta=this.meta.get(guildId);if(!meta || !allowed(meta.channelIds,channel))return [];
    const live=new Map(meta.files.map(f=>[f.id,f])),valid=[];
    for(const source of sources) {
      const row=live.get(source.fileId);
      if(!row || row.revision!==source.revision || row.sha256!==source.sha256 || row.state!=='ready')continue;
      try {const check=await this.remote(guildId,{action:'validate',id:source.fileId,revision:source.revision,channelId:channel.id,parentId:channel.isThread?.()?channel.parentId:null});if(check.valid)valid.push(source);}catch{}
    }
    return valid;
  }
}
module.exports={FilesKnowledge,sections};
