import { server } from "../../../../tools/server.js";

export async function serverAccessCheckerWepwawet(req, res) {
  const guildId = req.body?.guild;
  const serverId = req.body?.server;

  if (!guildId || !serverId) {
    return res.status(400).send("Missing guild or server id.");
  }

  const result = await server.addNew(guildId, serverId);
  return res.redirect(`/aiagents/serveraccess/wepwawet?guild=${guildId}&status=${result}`);
}
