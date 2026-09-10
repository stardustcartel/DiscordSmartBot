import { cookie, publicUrl } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const responseHeaders = new Headers({ Location: `${publicUrl(env, request)}/dashboard` });
  responseHeaders.append("Set-Cookie", cookie("dashboard_session", "", 0));
  responseHeaders.append("Set-Cookie", cookie("dashboard_oauth_state", "", 0));
  return new Response(null, { status: 302, headers: responseHeaders });
}
