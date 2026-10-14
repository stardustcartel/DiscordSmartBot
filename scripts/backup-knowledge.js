const fs = require("node:fs"), path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
async function main() {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || !fs.existsSync(source) || fs.existsSync(destination)) throw new Error("Usage: node scripts/backup-knowledge.js <existing-sqlite> <new-backup-path>; destination must not exist");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); fs.chmodSync(destination, 0o600); }
  finally { db.close(); }
  console.log("Consistent SQLite backup saved: " + destination);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
