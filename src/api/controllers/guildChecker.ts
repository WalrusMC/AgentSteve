import fs from "fs";
import { readFile } from "fs/promises";

let guilds: string[] = [];

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
  const message = err instanceof Error ? err.message : String(err);
  console.warn("Failed to watch guilds.json:", message);
}

// Valid Guild Checker
export async function guildChecker(req: any, res: any) {
  const guild = req.query?.guild as string | undefined;
  if (guild && guilds.includes(guild)) {
    res.status(200).json({ result: true });
  } else {
    res.status(200).json({ result: false });
  }
}
