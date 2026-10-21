import {cookie,cookies,publicUrl,unseal} from '../../_lib/auth.js';
import {authorizedGuild} from '../../_lib/authorize.js';
import {filesSchema,fileEvent,removeFile} from '../../_lib/files.js';
import {googleConfigured,googleExchange,driveRequest} from '../../_lib/google-drive.js';
import {encryptGuildKey} from '../../_lib/gemini-secret.js';
export async function onRequestGet({env,request}) {
  const url=new URL(request.url),base=publicUrl(env,request); let guildId='',outcome='failed',stage='session';
  try {
    const signed=url.searchParams.get('state'),state=await unseal(signed,env.DASHBOARD_SESSION_SECRET);
    if(!state || state.expiresAt<Date.now() || signed!==cookies(request).google_oauth_state) throw Error('Session expired.');
    const access=await authorizedGuild(env,request,state.guildId);
    if(!access || access.user.id!==state.userId) throw Error('Discord access changed.');
    guildId=state.guildId; stage='request'; await filesSchema(env.DB);
    const used=await env.DB.prepare('DELETE FROM google_oauth WHERE nonce=? AND guild_id=? AND user_id=? AND expires_at>? RETURNING nonce').bind(state.nonce,guildId,state.userId,Date.now()).first();
    if(!used) throw Error('Request expired.');
    if(url.searchParams.has('error')) outcome='cancelled';
    else {
      if(!googleConfigured(env) || !env.KNOWLEDGE_FILES) throw Error('Google setup incomplete.');
      stage='exchange';
      const token=await googleExchange(env,{grant_type:'authorization_code',code:url.searchParams.get('code') || '',redirect_uri:`${base}/auth/google/callback`});
      if(!token.refresh_token) throw Error('Google did not issue ongoing access. Retry connection.');
      stage='identity';
      const about=await (await driveRequest(token.access_token,'about?fields=user(displayName,emailAddress)')).json();
      const name=String(about.user?.displayName || about.user?.emailAddress || 'Google Drive');
      const email=String(about.user?.emailAddress || '');
      stage='save';
      const previous=await env.DB.prepare('SELECT generation FROM google_connections WHERE guild_id=?').bind(guildId).first();
      if(previous) {
        const files=await env.DB.prepare("SELECT * FROM file_sources WHERE guild_id=? AND kind='google' AND deleted=0").bind(guildId).all();
        await env.DB.prepare('DELETE FROM google_connections WHERE guild_id=?').bind(guildId).run();
        for(const file of files.results || []) await removeFile(env,file,access.user.id,'drive_reconnected');
      }
      const generation=crypto.randomUUID(),expiry=Date.now()+Number(token.expires_in || 3600)*1000;
      await env.DB.prepare('INSERT INTO google_connections(guild_id,generation,name,email,token_json,expires_at,connected_by,connected_at) VALUES (?,?,?,?,?,?,?,?)').bind(guildId,generation,name,email,JSON.stringify(await encryptGuildKey(JSON.stringify(token),env.GUILD_SECRETS_KEY)),expiry,access.user.id,Date.now()).run();
      await fileEvent(env,guildId,null,'drive_connected',{actorId:access.user.id,name,generation}); outcome='connected';
    }
  } catch(error) {
    if(stage!=='session') console.error('Google Drive connection failed',{stage,status:Number.isInteger(error.status)?error.status:null,name:error.name});
    outcome=stage==='session'?'session-expired':stage==='exchange'?'authorization-failed':stage==='identity'?'account-unavailable':'save-failed';
  }
  return new Response(null,{status:302,headers:{Location:`${base}/dashboard?google=${encodeURIComponent(outcome)}&guild=${encodeURIComponent(guildId)}`,'Set-Cookie':cookie('google_oauth_state','',0),'Cache-Control':'no-store'}});
}
