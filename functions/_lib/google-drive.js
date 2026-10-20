import { encryptGuildKey, decryptGuildKey } from './gemini-secret.js';
import { fileEvent, saveFile, removeFile } from './files.js';
import { fileExtensions, extension, limitedBytes, validFileId } from '../../shared/files.mjs';
export const googleConfigured = env => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GUILD_SECRETS_KEY);
export const driveScope='https://www.googleapis.com/auth/drive.readonly';
export async function googleExchange(env, values) {
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...values}),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Object.assign(Error('Google authorization failed. Reconnect Google Drive and check the application setup.'),{status:response.status});
  const token=await response.json(); if (!token.access_token) throw Error('Google did not return an access token.');
  return token;
}
export async function googleToken(env,row) {
  let token=JSON.parse(await decryptGuildKey(JSON.parse(row.token_json),env.GUILD_SECRETS_KEY));
  if (row.expires_at<Date.now()+120000) {
    const lock=await env.DB.prepare('UPDATE google_connections SET refresh_until=? WHERE guild_id=? AND generation=? AND refresh_until<?').bind(Date.now()+30000,row.guild_id,row.generation,Date.now()).run();
    if (!(lock.meta?.changes || lock.changes)) throw Error('Google authorization is refreshing. Please retry shortly.');
    try {
      const next=await googleExchange(env,{grant_type:'refresh_token',refresh_token:token.refresh_token});
      token={...next,refresh_token:next.refresh_token || token.refresh_token};
      await env.DB.prepare('UPDATE google_connections SET token_json=?,expires_at=?,refresh_until=0 WHERE guild_id=? AND generation=?').bind(JSON.stringify(await encryptGuildKey(JSON.stringify(token),env.GUILD_SECRETS_KEY)),Date.now()+Number(token.expires_in || 3600)*1000,row.guild_id,row.generation).run();
    } catch(error) { await env.DB.prepare('UPDATE google_connections SET refresh_until=0 WHERE guild_id=? AND generation=?').bind(row.guild_id,row.generation).run(); throw error; }
  }
  return token.access_token;
}
export async function driveRequest(token,path) {
  let response=await fetch('https://www.googleapis.com/drive/v3/'+path,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if ([301,302,303,307,308].includes(response.status)) {
    const destination=new URL(response.headers.get('Location') || '', 'https://www.googleapis.com');
    if(destination.protocol!=='https:' || !/^(?:[a-z0-9-]+\.)?googleusercontent\.com$/.test(destination.hostname)) throw Error('Google returned an unexpected download location.');
    response=await fetch(destination,{redirect:'error',signal:AbortSignal.timeout(20000)});
  }
  if (!response.ok) throw Object.assign(Error([401,403].includes(response.status)?'Google cannot read this content. Connect an account with access to the selected folder, or reconnect Google.':response.status===404?'This Google file was removed or is no longer accessible.':`Google Drive request failed (${response.status}); synchronization will retry.`),{status:response.status});
  return response;
}
export const driveFields='id,name,mimeType,size,modifiedTime,parents,trashed,capabilities(canDownload)';
export async function driveFile(token,id) {
  if (!validFileId(id)) throw Error('Invalid Google file ID.');
  return (await driveRequest(token,`files/${id}?supportsAllDrives=true&fields=${encodeURIComponent(driveFields)}`)).json();
}
export async function withinFolders(token,file,folders) {
  const seen=new Set(); let parents=file.parents || [];
  for(let depth=0;depth<20 && parents.length;depth++) {
    if(parents.some(id=>folders.some(f=>f.id===id))) return true;
    const id=parents[0]; if(seen.has(id)) return false; seen.add(id);
    const parent=await driveFile(token,id); if(parent.trashed) return false;
    parents=parent.parents || [];
  }
  return false;
}
export function driveFormat(file) {
  if(file.mimeType==='application/vnd.google-apps.document') return {name:file.name+'.txt',mime:'text/plain'};
  if(file.mimeType==='application/vnd.google-apps.spreadsheet') return {name:file.name+'.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  return fileExtensions.includes(extension(file.name)) ? {name:file.name,mime:null} : null;
}
// Reconcile one bounded page per worker pass. Only changed files are downloaded and embedded.
export async function syncDrive(env,guildId) {
  const row=await env.DB.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(guildId).first();
  if(!row) return;
  const folders=JSON.parse(row.folders_json), sync=JSON.parse(row.sync_json);
  if(!folders.length || (!sync.scan && Date.now()-(sync.checkedAt || 0)<300000)) return;
  try {
    const token=await googleToken(env,row);
    if(!sync.scan) { sync.scan=crypto.randomUUID(); sync.queue=folders.map(f=>f.id); sync.visited=[]; sync.cursor=null; sync.warning=''; sync.processed=0; await fileEvent(env,guildId,null,'drive_scan_started',{scan:sync.scan,folders:folders.map(f=>f.id)}); }
    const folderId=sync.queue[0];
    const query=new URLSearchParams({q:`'${folderId}' in parents and trashed = false`,pageSize:'10',fields:`nextPageToken,incompleteSearch,files(${driveFields})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    if(sync.cursor) query.set('pageToken',sync.cursor);
    const page=await (await driveRequest(token,'files?'+query)).json();
    if(page.incompleteSearch || !Array.isArray(page.files)) throw Error('Google returned an incomplete folder listing; existing files were preserved.');
    for(const file of page.files) {
      if(file.mimeType==='application/vnd.google-apps.folder') {
        if(!sync.visited.includes(file.id) && !sync.queue.includes(file.id)) {
          if(sync.visited.length+sync.queue.length>=100) throw Error('Folder selection exceeds 100 subfolders. Choose a smaller folder.');
          sync.queue.push(file.id);
        }
        continue;
      }
      const format=driveFormat(file); if(!format) continue;
      const existing=await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND generation=? AND drive_id=?').bind(guildId,row.generation,file.id).first();
      if(existing?.deleted===1) continue; // Explicit dashboard removal survives future syncs.
      if(existing?.drive_modified===file.modifiedTime && existing.name===format.name && existing.state!=='saving') {
        await env.DB.prepare('UPDATE file_sources SET scan=? WHERE id=?').bind(sync.scan,existing.id).run(); continue;
      }
      if(file.capabilities?.canDownload===false || Number(file.size)>10*1024*1024) {
        await fileEvent(env,guildId,existing?.id || null,'drive_file_skipped',{name:file.name,reason:file.capabilities?.canDownload===false?'download_denied':'over_10mb'});
        if(existing) await env.DB.prepare('UPDATE file_sources SET scan=? WHERE id=?').bind(sync.scan,existing.id).run();
        continue;
      }
      const path=format.mime ? `files/${file.id}/export?mimeType=${encodeURIComponent(format.mime)}` : `files/${file.id}?alt=media&supportsAllDrives=true`;
      const bytes=await limitedBytes(await driveRequest(token,path));
      // Confirm the connection/selection did not change during network calls.
      const current=await env.DB.prepare('SELECT generation,folders_json FROM google_connections WHERE guild_id=?').bind(guildId).first();
      if(!current || current.generation!==row.generation || current.folders_json!==row.folders_json) return;
      await saveFile(env,guildId,{id:existing?.id,kind:'google',driveId:file.id,generation:row.generation,name:format.name,description:existing?.description || '',modified:file.modifiedTime,scan:sync.scan},bytes);
      sync.processed++;
    }
    sync.cursor=page.nextPageToken || null;
    if(!sync.cursor) { sync.visited.push(sync.queue.shift()); }
    if(!sync.queue.length) {
      const gone=await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND generation=? AND deleted=0 AND (scan IS NULL OR scan!=?)').bind(guildId,row.generation,sync.scan).all();
      for(const file of gone.results || []) await removeFile(env,file,'google-sync','drive_removed');
      await fileEvent(env,guildId,null,'drive_scan_completed',{scan:sync.scan,changedFiles:sync.processed,removedFiles:gone.results?.length || 0});
      sync.scan=null; sync.checkedAt=Date.now();
    }
    sync.warning=''; sync.lastAttempt=Date.now();
  } catch(error) {
    sync.warning=error.message; sync.lastAttempt=Date.now();
    await fileEvent(env,guildId,null,'drive_scan_failed',{status:error.status || null,message:error.message});
  }
  await env.DB.prepare('UPDATE google_connections SET sync_json=? WHERE guild_id=? AND generation=? AND folders_json=?').bind(JSON.stringify(sync),guildId,row.generation,row.folders_json).run();
}
