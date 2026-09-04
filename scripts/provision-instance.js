const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const projectRoot = path.join(__dirname, "..");
const defaultRoot = path.join(projectRoot, "customer-instances");
const permissions = 1024 + 2048 + 16384 + 32768 + 65536 + 268435456;

async function ask(question, defaultValue = "") {
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultValue ? " [" + defaultValue + "] " : " ";
    return (await prompt.question(question + suffix)).trim() || defaultValue;
  } finally {
    prompt.close();
  }
}

function envValue(value) {
  return '"' + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function parseArgs() {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output") values.output = args[index + 1];
    if (args[index] === "--slug") values.slug = args[index + 1];
  }
  return values;
}

function copyProductSource(destination) {
  for (const fileName of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(
      path.join(projectRoot, fileName),
      path.join(destination, fileName),
    );
  }
  for (const directoryName of ["src", "config"]) {
    fs.cpSync(
      path.join(projectRoot, directoryName),
      path.join(destination, directoryName),
      { recursive: true },
    );
  }
}

function writeInstanceService(instanceDirectory, outputRoot) {
  const templatePath = path.join(
    projectRoot,
    "deploy",
    "discord-smart-bot@.service",
  );
  let service = fs.readFileSync(templatePath, "utf8");
  const normalizedRoot = outputRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  service = service.replaceAll(
    "/home/ubuntu/discord-smart-bots",
    normalizedRoot,
  );
  fs.writeFileSync(
    path.join(instanceDirectory, "discord-smart-bot@.service"),
    service,
  );
}

async function validateBotToken(token) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: "Bot " + token },
  });
  if (!response.ok) {
    throw new Error("Discord rejected the bot token with HTTP " + response.status);
  }
  return response.json();
}

async function main() {
  console.log("Discord Smart Bot instance provisioning");
  console.log("Run this on a trusted machine. Do not paste secrets into Discord.");

  const args = parseArgs();
  const slug = (await ask("Instance slug", args.slug || "customer-1"))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("A valid instance slug is required.");

  const outputRoot = path.resolve(args.output || defaultRoot);
  const instanceDirectory = path.join(outputRoot, slug);
  if (
    fs.existsSync(instanceDirectory) &&
    fs.readdirSync(instanceDirectory).length > 0
  ) {
    throw new Error(
      "The instance directory already contains files: " + instanceDirectory,
    );
  }

  const token = await ask("Customer bot token:");
  const applicationId = await ask("Discord application ID:");
  const geminiKey = await ask("Customer Gemini API key:");
  const botName = await ask("Bot name", "Discord Smart Bot");
  const avatarSource = await ask("Avatar image path (optional)");
  const personalitySource = await ask("Personality file path (optional)");
  const knowledgeChannels = await ask(
    "Knowledge channel IDs (comma-separated, optional)",
  );
  const timeZone = await ask(
    "Default reminder time zone",
    "America/Los_Angeles",
  );

  if (!token || !applicationId || !geminiKey) {
    throw new Error("Bot token, application ID, and Gemini API key are required.");
  }
  if (!/^\d{15,25}$/.test(applicationId)) {
    throw new Error("The Discord application ID must be a Discord snowflake.");
  }

  const botUser = await validateBotToken(token);
  fs.mkdirSync(instanceDirectory, { recursive: true });
  copyProductSource(instanceDirectory);
  fs.mkdirSync(path.join(instanceDirectory, "assets"), { recursive: true });
  fs.mkdirSync(path.join(instanceDirectory, "data"), { recursive: true });

  let avatarPath = "";
  if (avatarSource) {
    const source = path.resolve(avatarSource);
    if (!fs.existsSync(source)) throw new Error("Avatar file not found: " + source);
    const destination = path.join(instanceDirectory, "assets", path.basename(source));
    fs.copyFileSync(source, destination);
    avatarPath = "assets/" + path.basename(source);
  }

  const personalityDestination = path.join(
    instanceDirectory,
    "config",
    "personality.txt",
  );
  if (personalitySource) {
    const source = path.resolve(personalitySource);
    if (!fs.existsSync(source)) throw new Error("Personality file not found: " + source);
    fs.copyFileSync(source, personalityDestination);
  } else {
    fs.copyFileSync(
      path.join(projectRoot, "config", "personality.example.txt"),
      personalityDestination,
    );
  }

  const envLines = [
    "DISCORD_TOKEN=" + envValue(token),
    "DISCORD_APPLICATION_ID=" + envValue(applicationId),
    "BOT_NAME=" + envValue(botName),
    "BOT_AVATAR_PATH=" + envValue(avatarPath),
    "PERSONALITY_FILE=" + envValue("config/personality.txt"),
    "GEMINI_API_KEY=" + envValue(geminiKey),
    "GEMINI_MODEL=" + envValue("gemini-2.5-flash"),
    "AI_RESPONSES_PER_HOUR=30",
    "KNOWLEDGE_CHANNEL_IDS=" + envValue(knowledgeChannels),
    "REMINDER_TIME_ZONE=" + envValue(timeZone),
    "DATA_DIRECTORY=" + envValue("data"),
  ];
  fs.writeFileSync(
    path.join(instanceDirectory, ".env"),
    envLines.join("\n") + "\n",
    { mode: 0o600 },
  );

  const installUrl =
    "https://discord.com/oauth2/authorize?client_id=" +
    applicationId +
    "&scope=bot%20applications.commands&permissions=" +
    permissions;
  fs.writeFileSync(
    path.join(instanceDirectory, "INSTALL_URL.txt"),
    "Install " +
      botUser.username +
      " in the customer server using this URL:\n\n" +
      installUrl +
      "\n",
  );
  writeInstanceService(instanceDirectory, outputRoot);

  console.log("\nProvisioned " + botUser.username + " in " + instanceDirectory);
  console.log("Install URL: " + installUrl);
  console.log("Product source and an instance-specific systemd unit were copied.");
  console.log(
    "Next: run npm ci --omit=dev in the instance directory, then follow README.md.",
  );
}

main().catch((error) => {
  console.error("Provisioning failed:", error.message);
  process.exitCode = 1;
});
