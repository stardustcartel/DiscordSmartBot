const { stdin, stdout } = require("node:process");
const { config } = require("../src/config");
const { GuildSecretsStore } = require("../src/guild-secrets");

function getGuildId() {
  const args = process.argv.slice(2);
  const guildFlag = args.indexOf("--guild");
  return guildFlag >= 0 ? String(args[guildFlag + 1] || "").trim() : "";
}

function readSecret(question) {
  if (!stdin.isTTY || !stdin.setRawMode) {
    throw new Error("Run this command in an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    }
    stdin.on("data", onData);
  });
}

async function main() {
  const guildId = getGuildId();
  if (!/^\d{15,25}$/.test(guildId)) {
    throw new Error(
      "Usage: npm run set:gemini-key -- --guild CUSTOMER_GUILD_ID",
    );
  }
  const apiKey = await readSecret("Customer Gemini API key (hidden): ");
  const secrets = new GuildSecretsStore(config);
  secrets.setGeminiKey(guildId, apiKey);
  console.log("Encrypted Gemini API key saved for guild " + guildId + ".");
}

main().catch((error) => {
  console.error("Could not save Gemini key:", error.message);
  process.exitCode = 1;
});
