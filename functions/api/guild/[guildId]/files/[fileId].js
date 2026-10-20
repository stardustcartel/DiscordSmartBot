import { json } from '../../../../_lib/auth.js';
import { authorizedGuild } from '../../../../_lib/authorize.js';
import { filesSchema, textKey } from '../../../../_lib/files.js';
import { validFileId } from '../../../../../shared/files.mjs';
export async function onRequestGet({env,request,params}) {
  if(!await authorizedGuild(env,request,params.guildId)) return json({error:'Access denied.'},403);
  if(!validFileId(params.fileId)) return json({error:'Invalid file ID.'},400);
  await filesSchema(env.DB);
  const row=await env.DB.prepare('SELECT * FROM file_sources WHERE guild_id=? AND id=? AND deleted=0').bind(params.guildId,params.fileId).first();
  if(!row || !env.KNOWLEDGE_FILES) return json({error:'File unavailable.'},404);
  const text=new URL(request.url).searchParams.get('view')==='text', object=await env.KNOWLEDGE_FILES.get(text?textKey(row):row.object_key);
  if(!object) return json({error:text?'Extracted text is not ready.':'Original file is unavailable.'},404);
  const filename=(text?row.name+'.extracted.txt':row.name).replace(/["\r\n]/g,'_');
  return new Response(object.body,{headers:{'Content-Type':text?'text/plain; charset=utf-8':'application/octet-stream','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
