import fs from "fs/promises";
import { google } from "googleapis";

const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json"));
const oauth2Client = new google.auth.OAuth2(
  KEY_FILE.web.client_id,
  KEY_FILE.web.client_secret,
  "http://localhost:3000/aiagents/steve/oauth/google/callback"
);

export async function googleOAuth(req, res) {
  try {
    const code = req.query.code;
    const state = req.query.state?.split(",");
    const userId = state[0];
    const guildId = state[1];
    if (!code || !state) {
      return res.status(400).send(false);
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let users = {};
    try {
      users = JSON.parse(await fs.readFile(`./db/${guildId}/users.json`, "utf8"));
    } catch {}

    users[userId] = { ...(users[userId] || {}), token: tokens };

    await fs.writeFile(`./db/${guildId}/users.json`, JSON.stringify(users, null, 2));

    return res.status(200).send(true);
  } catch (err) {
    return res.status(500).send(false);
  }
}
