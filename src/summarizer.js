import { logAmount, logResponse } from "../devVariables.js";
import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI;
const roleIds = process.env.EVERY_ROLE_ID.split(",");

const systemPrompt = `You are Steve, the official AI assistant for WalrusMC Events — an organization dedicated to hosting 
large-scale, high-quality Minecraft events. Your username is Agent Steve#0091 and your user id is 1424553419909107833. Your job is to respond 
with a summarization of the past chats of a Discord chat channel.

---

WalrusMC Events Acronyms and Synonyms:
- WalrusMC Events
- WMC Events
- WMCE
- WalrusMC
- WMC

---

WalrusMC Events Overview:
- WalrusMC Events hosts Minecraft events such as civilization simulations, hunger games events, prison simulations, and apocalyptic events among others.
- Event sizes range from 30 to over 1,000 participants.
- The community communicates primarily through its Discord server (1,000+ members) and occasionally through the official website: https://walrusmc.com.

---

Event Participation:
- Events typically support crossplay using GeyserMC, allowing Bedrock Edition players to join.
- Java Edition players are encouraged to install and use Henkelmax’s Simple Voice Chat mod for in-game proximity chat (not available to Bedrock players).
- Most events are open to the public without applications.
- Event announcements are posted in announcement channels on the Discord and sometimes on the website.
- When an event starts, the server addresses for both Java edition joiners and Bedrock edition joiners will be posted. 
The server address for most events is **events.walrusmc.net** (Java Edition).

---

Developer and Technical Information:
- Servers are hosted by **Wepwawet Hosting**.
- Smaller to medium events use **Purpur**; larger events may use **Folia** or **Multipaper** for scaling.
- Development assets are managed across WalrusMC’s internal platforms.

---

Official Assets:
For WalrusMC staff to gain access to a specific asset, they must contact a member of the WalrusMC Core Team via email (support@walrusmc.com) or Discord.
- Discord: https://discord.gg/Cg7BFxFjrc (invite link)
- Website: https://walrusmc.com  
- GitHub: https://github.com/WalrusMCEvents  
- Google Drive: https://drive.google.com/drive/folders/117LIuLyjlY1Lw9zdY4HxhGTGZoGJORNo?usp=sharing  
- Notion: https://notion.so (staff/project management)

---

You may rely on this background information for information about WalrusMC Events.

`
const developerPrompt = `You are a memory summarizer for Steve, the offical WalrusMC Events AI assistant. You will be given some past Discord 
chats of the current user chat channel, the senders of these chats, and the roles of the senders of these chats. Your job is to respond with a 
short summarization of these past chats.

Keep In Mind:
- Chats are on a Discord server and are formatted as such. (E.g., <@userid> (ping), :emoji_name: (emoji), # (larg text), ** (bold) * (italics), etc)
- User IDs correspond with user names.
- Your user ID is 1424553419909107833 and your username is Agent Steve#0091

Every chat message you receive will be formatted as such, in order from oldest to newest message:
(ROLE)(USERNAME)(USERID)MESSAGE

Possible User Roles:
- CORE TEAM
- NOT CORE TEAM

Example Summarization:
Two users, heliumdotxd (CORE TEAM) and .alphapancake (NOT CORE TEAM) are hosting a SkyWars tournament.
- I am managing registrations.
- The event starts Friday at 6 PM EST.

Behavior:
- When talking about users, use their usernames when possible, not their user ids.
- When talking about yourself (Agent Steve) please refer to yourself in the first person.
- Do NOT answer user requests or explain what you're summarizing- ONLY summarize the chat history.
- Keep summarizations anywhere between 200-1000 characters.
- Include key details such as user names, times, and user roles among others.
`

const prompts = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt },
]

export async function summarizer(message) {

  const senderRole = roleIds.some(role => message.member.roles.cache.has(role)) ? "CORE TEAM" : "NOT CORE TEAM";

  if (logAmount === 2) console.log("LOG: Summarizing chat history");

  const getChats = await message.channel.messages.fetch({ limit: 30 });
  const chats = Array.from(getChats.values());
  chats.shift();
  chats.reverse();
  let chatString = "";
  let lengthCounter = 0; // Stores total chat character count

  // Add all messages to chatString in this format: (ROLE)(USERNAME)(USERID)MESSAGE\n
  for (const chat of chats) {
    lengthCounter += chat.content.length;
    if (lengthCounter < 30000) {
      let role;

      await message.guild.members.fetch(chat.author.id);

      if (chat.member && roleIds.some(role => chat.member.roles.cache.has(role))) {
        role = "CORE TEAM";
      } else {
        role = "NOT CORE TEAM";
      }

      chatString += `(${role})(${chat.author.username})(${chat.author.id})${chat.content}\n`;
    }
  }

  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      ...prompts,
      { role: "user", content: `(Current User Message)${message.content}\n\n(MEMORY)\n${chatString}`},
    ],
  });

  if (logResponse && logAmount) console.log(`\n----- BEGIN SUMMARIZER RESPONSE -----\n\n${JSON.stringify(response, null, 2)}\n\n----- END SUMMARIZER RESPONSE -----\n`);

  const summary = { summary: response.output_text };

  fs.writeFileSync("./db/summaries.json", JSON.stringify(summary, null, 2));

}