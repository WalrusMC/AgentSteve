import fs from "fs";
import { readFile } from "fs/promises";

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

export async function serverAccessPageWepwawet(req, res) {
  const guild = req.query?.guild;
  if (guild && guilds.includes(guild)) {
    res.status(200).sendFile("wepwawet.html", { root: "./public/html/serverAccess" });
  } else {
    res.status(404).send("404 Page Not Found :(");
  }
}
