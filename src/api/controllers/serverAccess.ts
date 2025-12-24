import { server} from "../../tools/server.js";

// Server Access Checker
export async function serverAccessChecker(req: any, res: any) {
  const guild = req.body?.guild;
  const serverId = req.body?.server;

  if (!guild || !serverId) {
    return res.status(400);
  }

  const result = await server.addNew(guild, serverId);
  return res.status(200).json({ guild: guild, result: result});
}
