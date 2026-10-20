import {json} from '../../../_lib/auth.js';
import {fileMeta,filesSchema,fileEvent,sha256,textKey} from '../../../_lib/files.js';
import {syncDrive,googleToken,withinFolders,driveFile} from '../../../_lib/google-drive.js';
import {validFileId,limitedBytes,filesPermitted} from '../../../../shared/files.mjs';
const authorized=(env,request)=>Boolean(env.BOT_SYNC_SECRET && request.headers.get('Authorization')===`Bearer ${env.BOT_SYNC_SECRET}`);
const safeFile=row=>({id:row.id,kind:row.kind,generation:row.generation,driveId:row.drive_id,name:row.name,description:row.description,size:row.size,sha256:row.sha256,revision:row.revision,state:row.state,status:JSON.parse(row.status_json || '{}'),updatedAt:row.updated_at,objectKey:row.object_key});
export async function onRequestPost({env,request,params}) {
  if(!authorized(env,request)) return json({error:'Unauthorized'},401);
  if(!/^\d{15,25}$/.test(params.guildId)) return json({error:'Invalid server'},400);
  if(!env.KNOWLEDGE_FILES) return json({error:'Private file storage is unavailable'},503);
  const guildId=params.guildId; await filesSchema(env.DB);
  let body; try {body=await request.json();} catch {return json({error:'Invalid request'},400);}
  if(!body || typeof body!=='object') return json({error:'Invalid request'},400);
  try {
    if(body.action==='sync') {await syncDrive(env,guildId); return json({ok:true});}
    if(body.action==='meta') {
      const meta=await fileMeta(env,guildId);
      return json({channelIds:meta.channelIds,files:meta.files.map(safeFile),google:meta.google?{connected:true,name:meta.google.name,folders:JSON.parse(meta.google.folders_json),sync:JSON.parse(meta.google.sync_json)}:{connected:false}});
    }
    if(!validFileId(body.id)) return json({error:'Invalid file ID'},400);
    const row=await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND id=? AND deleted=0').bind(guildId,body.id).first();
    if(!row || (body.revision && body.revision!==row.revision)) return json({error:'File changed'},409);
    if(body.action==='original') {
      const object=await env.KNOWLEDGE_FILES.get(row.object_key); if(!object) return json({error:'Original file missing'},404);
      const bytes=await limitedBytes(new Response(object.body),row.size+1);
      if(bytes.length!==row.size || await sha256(bytes)!==row.sha256) throw Error('Stored file hash mismatch.');
      await fileEvent(env,guildId,row.id,'original_fetched',{revision:row.revision,bytes:bytes.length});
      return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
    }
    if(body.action==='indexed' || body.action==='failed') {
      if(body.action==='indexed' && (typeof body.text!=='string' || body.text.length>800000)) return json({error:'Invalid extracted text'},400);
      const next=body.action==='indexed'?'ready':'error';
      const status={sections:Number(body.sections)||0,warning:String(body.warning||'').slice(0,500),textSha256:body.textSha256||null,localPath:String(body.localPath||'').slice(0,500),indexedAt:Date.now()};
      if(next==='ready') await env.KNOWLEDGE_FILES.put(textKey(row),body.text,{httpMetadata:{contentType:'text/plain; charset=utf-8'}});
      const updated=await env.DB.prepare('UPDATE file_sources SET state=?,status_json=?,updated_at=? WHERE guild_id=? AND id=? AND revision=? AND deleted=0').bind(next,JSON.stringify(status),Date.now(),guildId,row.id,row.revision).run();
      if(!(updated.meta?.changes||updated.changes)) return json({error:'File changed'},409);
      await fileEvent(env,guildId,row.id,next==='ready'?'indexed':'index_failed',{revision:row.revision,sections:status.sections,warning:status.warning,textSha256:status.textSha256,localPath:status.localPath});
      return json({ok:true});
    }
    if(body.action==='progress') {
      const status=JSON.parse(row.status_json || '{}');
      status.sections=Number(body.total)||0;status.semanticReady=Math.max(0,Math.min(status.sections,Number(body.embedded)||0));status.semanticCheckedAt=Date.now();
      await env.DB.prepare('UPDATE file_sources SET status_json=? WHERE guild_id=? AND id=? AND revision=? AND deleted=0').bind(JSON.stringify(status),guildId,row.id,row.revision).run();
      return json({ok:true});
    }
    if(body.action==='validate') {
      const ids=Array.isArray(body.channelIds)?body.channelIds:[];
      const meta=await fileMeta(env,guildId);
      if(!filesPermitted(meta.channelIds,{id:body.channelId,parentId:body.parentId,isThread:()=>Boolean(body.parentId)})) return json({valid:false});
      if(row.kind==='google') {
        if(!meta.google || row.generation!==meta.google.generation) return json({valid:false});
        const folders=JSON.parse(meta.google.folders_json);
        const token=await googleToken(env,meta.google);
        const file=await driveFile(token,row.drive_id);
        if(file.trashed || !await withinFolders(token,file,folders)) return json({valid:false});
      }
      return json({valid:true,revision:row.revision,sha256:row.sha256});
    }
    return json({error:'Unknown action'},400);
  } catch(error) {return json({error:error.message || 'File operation failed'},error.status || 502);}
}
