import fs from "fs/promises";
import { google } from "googleapis";
import { createLogger } from "../../utils/logger.js";
const log = createLogger();
// Load OAuth client secrets
const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json", "utf8"));
const oauth2Client = new google.auth.OAuth2(KEY_FILE.web.client_id, KEY_FILE.web.client_secret, "http://localhost:3000/aiagents/steve/oauth/google/callback");
export async function googleOAuth(req, res) {
    try {
        const token = req.body?.token;
        const guild = req.body?.guild;
        const user = req.body?.user;
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
        // Load existing users (if any)
        let users = {};
        try {
            users = JSON.parse(await fs.readFile(`./db/${guild}/users.json`, "utf8"));
        }
        catch {
            log.error("The users.json file could not be found.");
            return res.sendStatus(500);
        }
        // Persist tokens under `tokens` for the requesting user (matches gdoc.read)
        const userId = String(user);
        users[userId] = { ...(users[userId] || {}), tokens: token };
        await fs.writeFile(`./db/${guild}/users.json`, JSON.stringify(users, null, 2));
        return res.sendStatus(204);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Google OAuth failed:", message);
        return res.sendStatus(500);
    }
}
