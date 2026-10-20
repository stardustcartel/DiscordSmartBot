import { fileLimits, fileName, extension, fileExtensions } from '../../shared/files.mjs';
export { fileLimits };
export async function filesSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS file_settings (guild_id TEXT PRIMARY KEY, channel_ids TEXT NOT NULL DEFAULT '[]')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS file_sources (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, kind TEXT NOT NULL, drive_id TEXT, generation TEXT,
      name TEXT NOT NULL, description TEXT NOT NULL, extension TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, object_key TEXT NOT NULL, revision TEXT NOT NULL, state TEXT NOT NULL,
      status_json TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, actor_id TEXT NOT NULL, drive_modified TEXT,
      scan TEXT, UNIQUE(guild_id,generation,drive_id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS file_sources_guild ON file_sources(guild_id,deleted)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS file_events (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, file_id TEXT, event TEXT NOT NULL, at INTEGER NOT NULL, detail_json TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS file_events_guild ON file_events(guild_id,id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS google_connections (guild_id TEXT PRIMARY KEY, generation TEXT NOT NULL, name TEXT NOT NULL, token_json TEXT NOT NULL, expires_at INTEGER NOT NULL, refresh_until INTEGER NOT NULL DEFAULT 0, folders_json TEXT NOT NULL DEFAULT '[]', sync_json TEXT NOT NULL DEFAULT '{}', connected_by TEXT NOT NULL, connected_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS google_oauth (nonce TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`),
  ]);
}
export const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
export async function fileEvent(env, guildId, fileId, event, detail = {}) {
  // No file bodies or credentials here. Original/extracted content has separate authenticated downloads.
  await env.DB.prepare('INSERT INTO file_events(guild_id,file_id,event,at,detail_json) VALUES (?,?,?,?,?)').bind(guildId, fileId || null, event, Date.now(), JSON.stringify(detail).slice(0,12000)).run();
  await env.DB.prepare('DELETE FROM file_events WHERE guild_id=? AND at<?').bind(guildId, Date.now()-30*86400000).run();
}
export async function fileMeta(env, guildId) {
  await filesSchema(env.DB);
  const settings = await env.DB.prepare('SELECT channel_ids FROM file_settings WHERE guild_id=?').bind(guildId).first();
  const rows = await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND deleted=0 ORDER BY created_at DESC').bind(guildId).all();
  const google = await env.DB.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(guildId).first();
  return { channelIds: settings ? JSON.parse(settings.channel_ids) : [], files: rows.results || [], google };
}
export const textKey = row => `${row.object_key}.text.txt`;
export async function removeFile(env, row, actorId, reason = 'deleted') {
  await env.DB.prepare('UPDATE file_sources SET deleted=?,state=?,updated_at=? WHERE id=? AND guild_id=?').bind(reason === 'deleted' ? 1 : 2,reason,Date.now(),row.id,row.guild_id).run();
  if (env.KNOWLEDGE_FILES) await env.KNOWLEDGE_FILES.delete([row.object_key,textKey(row)]);
  await fileEvent(env,row.guild_id,row.id,reason,{actorId,objectKey:row.object_key});
}
export async function saveFile(env, guildId, input, bytes) {
  if (!env.KNOWLEDGE_FILES) throw Error('File storage is not configured. Contact the service owner.');
  const name=fileName(input.name), ext=extension(name), size=bytes.length;
  if (!fileExtensions.includes(ext)) throw Error('Choose a TXT, MD, CSV, DOCX, XLSX, or PDF file.');
  if (!size || size>fileLimits.bytes) throw Error('Files must contain data and be no larger than 10 MB.');
  const id=input.id || crypto.randomUUID(), revision=crypto.randomUUID(), objectKey=`knowledge/${guildId}/${id}/${revision}/original.${ext}`;
  const hash=await sha256(bytes), now=Date.now();
  const old=input.id && await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND id=? AND deleted!=1').bind(guildId,id).first();
  // One SQLite statement reserves quota atomically across simultaneous uploads and Drive imports.
  const reserve=await env.DB.prepare(`INSERT INTO file_sources(id,guild_id,kind,drive_id,generation,name,description,extension,size,sha256,object_key,revision,state,created_at,updated_at,actor_id,drive_modified,scan)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'saving',?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM file_sources WHERE guild_id=? AND deleted=0 AND id!=?)<?
    AND (SELECT COALESCE(SUM(size),0) FROM file_sources WHERE guild_id=? AND deleted=0 AND id!=?)+?<=?
    AND (SELECT COALESCE(SUM(size),0) FROM file_sources WHERE deleted=0 AND id!=?)+?<=?
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,extension=excluded.extension,size=excluded.size,sha256=excluded.sha256,object_key=excluded.object_key,revision=excluded.revision,state='saving',deleted=0,status_json='{}',updated_at=excluded.updated_at,drive_modified=excluded.drive_modified,scan=excluded.scan
    WHERE file_sources.guild_id=excluded.guild_id AND file_sources.deleted!=1`)
    .bind(id,guildId,input.kind || 'upload',input.driveId || null,input.generation || null,name,String(input.description || '').slice(0,fileLimits.description),ext,size,hash,objectKey,revision,now,now,input.actorId || 'google-sync',input.modified || null,input.scan || null,guildId,id,fileLimits.count,guildId,id,size,fileLimits.guildBytes,id,size,fileLimits.globalBytes).run();
  if (!(reserve.meta?.changes || reserve.changes)) throw Error('Storage limit reached: 50 files / 100 MB per server, or service capacity. Remove unused files first.');
  try {
    await env.KNOWLEDGE_FILES.put(objectKey,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:hash,guildId,fileId:id,revision}});
    const row=await env.DB.prepare('SELECT * FROM file_sources WHERE id=? AND guild_id=?').bind(id,guildId).first();
    if (row.deleted || row.revision!==revision) { await env.KNOWLEDGE_FILES.delete(objectKey); throw Error('File changed while it was being saved.'); }
    await env.DB.prepare("UPDATE file_sources SET state='queued' WHERE id=? AND guild_id=? AND revision=? AND deleted=0").bind(id,guildId,revision).run();
    if (old && old.object_key!==objectKey) await env.KNOWLEDGE_FILES.delete([old.object_key,textKey(old)]);
    await fileEvent(env,guildId,id,'original_saved',{actorId:input.actorId || 'google-sync',name,bytes:size,sha256:hash,revision,objectKey});
    return {id,revision};
  } catch(error) {
    await env.DB.prepare("UPDATE file_sources SET state='error',status_json=? WHERE id=? AND revision=? AND deleted=0").bind(JSON.stringify({warning:'Original could not be saved. Delete and upload again.'}),id,revision).run();
    await fileEvent(env,guildId,id,'original_save_failed',{revision});
    throw error;
  }
}
