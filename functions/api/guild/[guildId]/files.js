import { json, cookie, publicUrl, seal } from '../../../_lib/auth.js';
import { authorizedGuild } from '../../../_lib/authorize.js';
import { filesSchema, fileMeta, fileEvent, saveFile, removeFile } from '../../../_lib/files.js';
import { googleConfigured, driveScope, driveFile, driveRequest, googleToken, googleAccountEmail } from '../../../_lib/google-drive.js';
import { fileChannels, fileLimits, limitedBytes, validFileId } from '../../../../shared/files.mjs';

const noStore = {'Cache-Control':'no-store'};
const deny = () => json({error:'You do not have access to this server.'},403,noStore);
const originOk = request => request.headers.get('Origin') === new URL(request.url).origin;
const publicRow = row => ({id:row.id,kind:row.kind,name:row.name,description:row.description,size:row.size,sha256:row.sha256,revision:row.revision,state:row.state,status:JSON.parse(row.status_json || '{}'),createdAt:row.created_at,updatedAt:row.updated_at,actorId:row.actor_id,driveId:row.drive_id || null,objectKey:row.object_key});
async function channelsValid(env,guildId,ids) {
  const res=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});
  if(!res.ok) throw Error('Could not verify channels.');
  const channels=await res.json();
  if(ids.some(id=>!channels.some(c=>c.id===id && [0,5,15].includes(c.type)))) throw Error('Choose channels from this server.');
}
export async function onRequestGet({env,request,params}) {
  if(!await authorizedGuild(env,request,params.guildId)) return deny();
  const meta=await fileMeta(env,params.guildId), url=new URL(request.url);
  if(url.searchParams.get('download')==='events') {
    const rows=await env.DB.prepare('SELECT * FROM file_events WHERE guild_id=? ORDER BY id DESC LIMIT 5000').bind(params.guildId).all();
    const text=(rows.results || []).reverse().map(row=>JSON.stringify({...row,detail:JSON.parse(row.detail_json)})).join('\n')+'\n';
    return new Response(text,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="file-ingestion-events.jsonl"',...noStore}});
  }
  const status=meta.files.reduce((v,f)=>(v[f.state]=(v[f.state]||0)+1,v),{});
  const email=meta.google?await googleAccountEmail(env,meta.google):'';
  return json({configured:Boolean(env.KNOWLEDGE_FILES && env.BOT_SYNC_SECRET),googleConfigured:googleConfigured(env),google:meta.google?{connected:true,name:meta.google.name,email,folders:JSON.parse(meta.google.folders_json),sync:JSON.parse(meta.google.sync_json)}:{connected:false},channelIds:meta.channelIds,files:meta.files.map(publicRow),status,limits:{maxFile:fileLimits.bytes,maxCount:fileLimits.count,maxGuildBytes:fileLimits.guildBytes}},200,noStore);
}
export async function onRequestPost({env,request,params}) {
  const access=await authorizedGuild(env,request,params.guildId); if(!access) return deny();
  if(!originOk(request)) return json({error:'Invalid request origin.'},403,noStore);
  await filesSchema(env.DB);
  const guildId=params.guildId, type=request.headers.get('Content-Type') || '';
  try {
    if(type.startsWith('multipart/form-data')) {
      if(Number(request.headers.get('Content-Length'))>fileLimits.bytes+65536) return json({error:'File exceeds the 10 MB limit.'},413,noStore);
      const form=await request.formData(), file=form.get('file'), description=String(form.get('description') || '').trim();
      if(!(file instanceof File) || !description || description.length>fileLimits.description) return json({error:'Choose a file and a description of at most 2,000 characters.'},400,noStore);
      if(file.size>fileLimits.bytes) return json({error:'File exceeds the 10 MB limit.'},413,noStore);
      const result=await saveFile(env,guildId,{name:file.name,description,actorId:access.user.id},new Uint8Array(await file.arrayBuffer()));
      return json({ok:true,...result},200,noStore);
    }
    const body=await request.json(); if(!body || typeof body!=='object') throw Error('Invalid action.');
    if(body.action==='connect') {
      if(!googleConfigured(env) || !env.KNOWLEDGE_FILES) return json({error:'Google Drive setup is pending. The service owner must configure Google OAuth and private file storage.'},503,noStore);
      const nonce=crypto.randomUUID(), expiresAt=Date.now()+600000;
      await env.DB.prepare('DELETE FROM google_oauth WHERE expires_at<?').bind(Date.now()).run();
      await env.DB.prepare('INSERT INTO google_oauth VALUES (?,?,?,?)').bind(nonce,guildId,access.user.id,expiresAt).run();
      const state=await seal({nonce,guildId,userId:access.user.id,expiresAt},env.DASHBOARD_SESSION_SECRET);
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:`${publicUrl(env,request)}/auth/google/callback`,response_type:'code',scope:driveScope,access_type:'offline',prompt:'consent',state});
      return json({url:url.href},200,{...noStore,'Set-Cookie':cookie('google_oauth_state',state,600)});
    }
    if(body.action==='visibility') {
      const ids=fileChannels(body.channelIds); await channelsValid(env,guildId,ids);
      await env.DB.prepare('INSERT INTO file_settings(guild_id,channel_ids) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_ids=excluded.channel_ids').bind(guildId,JSON.stringify(ids)).run();
      await fileEvent(env,guildId,null,'visibility_saved',{actorId:access.user.id,channelIds:ids}); return json({ok:true},200,noStore);
    }
    if(body.action==='listFolders') {
      const row=await env.DB.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(guildId).first(); if(!row) throw Error('Connect Google Drive first.');
      const parent=body.parent || 'root'; if(parent!=='root' && !validFileId(parent)) throw Error('Invalid folder.');
      const token=await googleToken(env,row);
      const query=new URLSearchParams({q:`'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,fields:'nextPageToken,files(id,name,mimeType)',pageSize:'100',orderBy:'name',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      const data=await (await driveRequest(token,'files?'+query)).json();
      return json({folders:(data.files || []).map(f=>({id:f.id,name:f.name})),more:Boolean(data.nextPageToken)},200,noStore);
    }
    if(body.action==='validateFolder') {
      if(!validFileId(body.folderId))throw Error('Enter a valid Google Drive folder ID.');
      const row=await env.DB.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(guildId).first();if(!row)throw Error('Connect Google Drive first.');
      const folder=await driveFile(await googleToken(env,row),body.folderId);
      if(folder.trashed || folder.mimeType!=='application/vnd.google-apps.folder')throw Error('This link is not an available Google Drive folder. Choose a folder rather than an individual file.');
      const current=await env.DB.prepare('SELECT generation FROM google_connections WHERE guild_id=?').bind(guildId).first();
      if(current?.generation!==row.generation)throw Error('The connected Google account changed. Try adding this folder again.');
      return json({folder:{id:folder.id,name:folder.name}},200,noStore);
    }
    if(body.action==='folders') {
      const row=await env.DB.prepare('SELECT * FROM google_connections WHERE guild_id=?').bind(guildId).first(); if(!row) throw Error('Connect Google Drive first.');
      const ids=body.folderIds;
      if(!Array.isArray(ids) || ids.length>10 || ids.some(id=>!validFileId(id))) throw Error('Choose up to 10 valid folders.');
      const token=await googleToken(env,row), folders=[];
      for(const id of [...new Set(ids)]) { const f=await driveFile(token,id); if(f.trashed || f.mimeType!=='application/vnd.google-apps.folder') throw Error('A selected folder could not be read. Connect an account with access to it.'); folders.push({id,name:f.name}); }
      await env.DB.prepare('UPDATE google_connections SET folders_json=?,sync_json=? WHERE guild_id=? AND generation=?').bind(JSON.stringify(folders),JSON.stringify({}),guildId,row.generation).run();
      await fileEvent(env,guildId,null,'folders_saved',{actorId:access.user.id,folders}); return json({ok:true,folders},200,noStore);
    }
    if(body.action==='sync') {
      await env.DB.prepare('UPDATE google_connections SET sync_json=? WHERE guild_id=?').bind('{}',guildId).run();
      await fileEvent(env,guildId,null,'sync_requested',{actorId:access.user.id}); return json({ok:true},200,noStore);
    }
    if(body.action==='disconnect') {
      await env.DB.prepare('DELETE FROM google_connections WHERE guild_id=?').bind(guildId).run();
      const files=await env.DB.prepare("SELECT * FROM file_sources WHERE guild_id=? AND kind='google' AND deleted=0").bind(guildId).all();
      for(const row of files.results || []) await removeFile(env,row,access.user.id,'drive_disconnected');
      await fileEvent(env,guildId,null,'drive_disconnected',{actorId:access.user.id}); return json({ok:true},200,noStore);
    }
    if(body.action==='description' || body.action==='delete' || body.action==='retry') {
      if(!validFileId(body.id)) throw Error('Invalid file ID.');
      const row=await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND id=? AND deleted=0').bind(guildId,body.id).first(); if(!row) return json({error:'File not found.'},404,noStore);
      if(body.action==='delete') await removeFile(env,row,access.user.id);
      else if(body.action==='description') { const value=String(body.description || '').trim(); if(value.length>fileLimits.description) throw Error('Description is too long.'); await env.DB.prepare('UPDATE file_sources SET description=?,updated_at=? WHERE id=?').bind(value,Date.now(),row.id).run(); await fileEvent(env,guildId,row.id,'description_saved',{actorId:access.user.id}); }
      else { await env.DB.prepare("UPDATE file_sources SET state='queued',status_json='{}',updated_at=? WHERE id=?").bind(Date.now(),row.id).run(); await fileEvent(env,guildId,row.id,'index_retry_requested',{actorId:access.user.id}); }
      return json({ok:true},200,noStore);
    }
    throw Error('Unknown action.');
  } catch(error) { return json({error:error.message || 'Action failed.'},error.status || 400,noStore); }
}
