import fs from "fs/promises";
import path from "path";

/**
 * Make sure every per-guild datastore exists before we try to read it.
 * This prevents the responder/router pipeline from crashing on first run.
 */
export async function ensureDBs(guildId: string) {
  const guildDbDir = path.join("db", guildId);
  const downloadsDir = path.join("src", "tools", "downloads", guildId);

  const ensureDir = async (dir: string) => {
    await fs.mkdir(dir, { recursive: true });
  };

  const ensureFile = async (filePath: string, defaultContent: string) => {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, defaultContent);
    }
  };

  await ensureDir(guildDbDir);
  await ensureDir(downloadsDir);

  await ensureFile(path.join(guildDbDir, "servers.json"), "{}")
  await ensureFile(path.join(guildDbDir, "downloads.json"), "{}");
  await ensureFile(path.join(guildDbDir, "summaries.json"), "{}");
  await ensureFile(path.join(guildDbDir, "whitelist.json"), JSON.stringify({ users: [], roles: [] }, null, 2));
  await ensureFile(path.join(guildDbDir, "plugins.json"), "[]");
  await ensureFile(path.join(guildDbDir, "users.json"), "{}");
}
