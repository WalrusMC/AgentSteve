import fs from "fs/promises";
import { google } from "googleapis";
import { createLogger } from "../../utils/logger.js";
import { prisma } from "../../../lib/prisma.js";

const log = createLogger();

// Load OAuth client secrets
const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json", "utf8"));
const oauth2Client = new google.auth.OAuth2(
  KEY_FILE.web.client_id,
  KEY_FILE.web.client_secret,
  "http://localhost:3000/aiagents/steve/oauth/google/callback"
);

export async function googleOAuth(req: any, res: any) {
  try {
    const token = req.body?.token;
    const guild: string = req.body?.guild;
    const user: string = req.body?.user;

    // Require OAuth token and state data
    if (!token || !user || !guild) {
      log.error("Google OAuth callback missing required fields.", {
        hasToken: !!token,
        hasUser: !!user,
        hasGuild: !!guild,
        contentType: req.headers?.["content-type"],
        bodyKeys: Object.keys(req.body || {}),
      });
      return res.status(400).json({ error: "Missing token, user, or guild" });
    }

    // Persist tokens under `tokens` for the requesting user (matches gdoc.read)
    const userId = String(user);
    await prisma.user.upsert({
      where: {
        guildId: guild,
        id: user
      },
      create: {
        guildId: guild,
        id: user,
        token: token
      },
      update: {
        token: JSON.stringify(token)
      }
    });

    return res.sendStatus(204);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Google OAuth failed:", message);
    return res.sendStatus(500);
  }
}
