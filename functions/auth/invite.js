import { publicUrl } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const invite = new URL("https://discord.com/oauth2/authorize");
  invite.search = new URLSearchParams({ client_id: env.DISCORD_APPLICATION_ID, scope: "bot applications.commands", permissions: "84992", redirect_uri: `${publicUrl(env, request)}/dashboard` }).toString();
  return Response.redirect(invite.toString(), 302);
}
