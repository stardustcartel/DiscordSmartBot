require("dotenv").config();

const applicationId = String(process.env.DISCORD_APPLICATION_ID || "").trim();
if (!/^\d{15,25}$/.test(applicationId)) {
  console.error("Set DISCORD_APPLICATION_ID in .env before generating an invite URL.");
  process.exit(1);
}

const permissions =
  1024 +
  2048 +
  16384 +
  32768 +
  65536 +
  67108864 +
  268435456;

console.log(
  "https://discord.com/oauth2/authorize?client_id=" +
    applicationId +
    "&scope=bot%20applications.commands&permissions=" +
    permissions,
);
