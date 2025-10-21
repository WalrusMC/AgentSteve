import { logAmount, logResponse } from "../devVariables.js";
import OpenAI from "openai";

const client = new OpenAI;

const systemPrompt = `Any user messaging you is a verified member of the WalrusMC Events Core Team. You are Steve, the official AI assistant for WalrusMC Events — an organization dedicated to hosting 
large-scale, high-quality Minecraft events. Your job is to assist staff with information, event management, and 
development tasks. Always be professional, helpful, and accurate. Keep your answers concise unless the user asks for detailed 
guidance or technical depth. For most questions, aim for 2-4 short paragraphs or less. Offer to elaborate if needed.

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
For WalrusMC staff to gain access to a specific asset, they must contact a member of the WalrusMC Core Team via email or Discord.
- Discord: https://discord.gg/Cg7BFxFjrc (invite link)
- Website: https://walrusmc.com  
- GitHub: https://github.com/WalrusMCEvents  
- Google Drive: https://drive.google.com/drive/folders/117LIuLyjlY1Lw9zdY4HxhGTGZoGJORNo?usp=sharing  
- Notion: https://notion.so (staff/project management)

---

Behavior:
- When discussing WalrusMC Events, rely on this background information.
- If asked about real-world topics, respond neutrally and professionally.
- If uncertain about an event or detail, clarify that information may need verification through official sources.

`;

const developerPrompt = `A reasoning controller for you, Steve, an AI Agent Assistant for WalrusMC Events, 
has already chosen to send this user message to you based on user request or complexity of the message.
Please respond to the user message to the best of your ability and use any tools at your disposal that you feel are neccessary.

Your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), bold text (**text**), italics (*text*), large text(# text), and more in your response.`

const prompt = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt },
]

export async function respond(model, message) {
  if (logAmount) console.log(`LOG: gpt-5-nano chose ${model} to handle this message`);

  // Send request to OpenAI API
  const response = await client.responses.create({
    model: model,
    input: [
      ...prompt,
      { role: "user", content: message.content },
    ],
    tools: [
      { type: "web_search" }
    ],
  });

  if (logResponse && logAmount) console.log(`LOG: ${response}`);

  const sentMessages = [];

  if (response.output_text) {
    if (logAmount >= 2) console.log(`LOG: Recieved response.output_text with a length of ${response.output_text.length} characters`);

    const maxLength = 2000;
    const separator = "\n"
    let responsePiece = response.output_text; // Response to be broken down into messageSections[]
    const messageSections = []; // Array to store all message sections

    // While responsePiece is still a non-empty string
    while(responsePiece) {
      // If responsePiece.length > maxLength
      // Take responsePiece[0] through responsePiece[index of the nearest character to the maxLength right before the separator]
      if (responsePiece?.length > maxLength) {
        if (logAmount === 2) console.log("LOG: Splitting response.output_text");

        messageSections.push(
          responsePiece.substring(
            0,
            responsePiece.lastIndexOf(separator, maxLength)
          )
        )
      } else {
        // Add the remaining characters in responsePiece to messageSections[]
        messageSections.push(responsePiece);
        responsePiece = false;
        break;
      }

      // Remove responsePiece[0] through responsePiece[index of last character of the separator]
      responsePiece = responsePiece?.slice(responsePiece?.lastIndexOf(separator, maxLength) + 1);
    }

    for (const messageSection of messageSections) {
      if (logAmount === 2) console.log(`LOG: Sending a message with a length of ${messageSection.length} characters`);
      sentMessages.push(await message.channel.send(messageSection));
    }
    return sentMessages;
    
  } else {
    console.log("ERR: GPT did not send a valid response or call a tool!");
    sentMessages.push(await message.channel.send("Oh no! An error has occurred."));
    return sentMessages;
  }
};