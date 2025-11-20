import OpenAI from "openai";
import fs from "fs/promises";
import { createLogger } from "./utils/logger.js";
import { getPastChats } from "./utils/getPastChats.js";

const client = new OpenAI;
const log = createLogger("summarizer");

const systemPrompt = `You are Steve, an AI assistant for Minecraft server owners and you live on Discord. You assist 
users with development tasks like writing code, creating Minecraft plugins, executing console commands, 
uploading/editing/deleting server files, and answering questions among others.
`;

const developerPrompt = `You are a memory summarizer, part of a multi-model AI system named called Steve.
You will recieve past chats and information about these chats and your job is to respond with a 
short summarization of these past chats.

Keep In Mind:
- Chats are on a Discord server and are formatted as such. (E.g., <@userid> (ping), :emoji_name: (emoji), # (larg text), ** (bold) * (italics), etc)
- User IDs correspond with user names.
- Your user ID is 1424553419909107833 and your username is Agent Steve#0091

Every chat message you receive will be formatted as such, in order from oldest to newest message:
(ROLE)(USERNAME)(USERID)MESSAGE

Possible User Roles:
- ADMINISTRATOR
- NOT ADMINISTRATOR

Example Summarization:
Two users, heliumdotxd (ADMINISTRATOR) and .alphapancake (NOT ADMINISTRATOR) are hosting a SkyWars tournament.
- I am managing registrations.
- The event starts Friday at 6 PM EST.

Behavior:
- When talking about users, use their usernames when possible, not their user ids.
- When talking about yourself (Agent Steve) please refer to yourself in the first person.
- Do NOT answer user requests or explain what you're summarizing- ONLY summarize the chat history.
- Keep summarizations anywhere between 200-1000 characters.
- Include key details such as user names, times, and user roles among others.
`;

const prompts = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt },
]

/**
 * Creates and stores a concise summary of recent channel messages to provide
 * conversational context for Steve.
 */
export async function summarizer(message) {
  log.debug("Summarizing recent chat history");

  const pastChats = await getPastChats(message);

  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      ...prompts,
      { role: "user", content: `(Current User Message)${message.content}\n\n(MEMORY)\n${JSON.stringify(pastChats, null, 2)}`},
    ],
  });

  log.response("SUMMARIZER RESPONSE", response);

  const summaries = JSON.parse(await fs.readFile(`./db/${message.guildId}/summaries.json`, "utf-8"));

  summaries[message.channel.id] = response.output_text;

  await fs.writeFile(`./db/${message.guildId}/summaries.json`, JSON.stringify(summaries, null, 2));

}
