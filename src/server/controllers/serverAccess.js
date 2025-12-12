import fs from "fs";
import { readFile } from "fs/promises";
import { server} from "../../tools/server.js";

let guilds = [];

const loadGuilds = async () => {
  try {
    guilds = JSON.parse(await readFile("./db/guilds.json", "utf8"));
  } catch {
    guilds = [];
  }
};

await loadGuilds();

// Watch for changes to guilds.json and reload automatically
try {
  fs.watch("./db/guilds.json", async () => {
    console.log("guilds.json updated, reloading...");
    await loadGuilds();
  });
} catch (err) {
  console.warn("Failed to watch guilds.json:", err?.message || err);
}

// Main Page
export async function serverAccessPage(req, res) {
  const guild = req.query?.guild;
  if (guild && guilds.includes(guild)) {
    res.status(200).sendFile("serverAccess.html", { root: "./public/html/aiAgents" });
  } else {
    res.status(404).sendFile("404.html", { root: "./public/html/aiAgents" });
  }
}

// Handle Checks
export async function serverAccessChecker(req, res) {
  const guildId = req.body?.guild;
  const serverId = req.body?.server;

  if (!guildId || !serverId) {
    return res.status(400).send("Missing guild or server id.");
  }

  const result = await server.addNew(guildId, serverId);
  return res.redirect(`/aiagents/serveraccess?guild=${guildId}&status=${result}`);
}
