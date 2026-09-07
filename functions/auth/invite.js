export async function onRequestGet({ env }) {
  const invite = new URL("https://discord.com/oauth2/authorize");
  invite.search = new URLSearchParams({ client_id: env.DISCORD_APPLICATION_ID, scope: "bot applications.commands", permissions: "84992" }).toString();
  return Response.redirect(invite.toString(), 302);
}
