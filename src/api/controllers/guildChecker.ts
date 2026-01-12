import { prisma } from "../../../lib/prisma.js";

// Valid Guild Checker
export async function guildChecker(req: any, res: any) {
  const guilds = (await prisma.guild.findMany({})).map(obj => obj.id);
  const guild = req.query?.guild as string | undefined;
  if (guild && guilds.includes(guild)) {
    res.status(200).json({ result: true });
  } else {
    res.status(200).json({ result: false });
  }
}
