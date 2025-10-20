import { logAmount, logResponse } from "../devVariables.js";
import OpenAI from "openai";
import { respond } from "./responder.js";

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
For WalrusMC staff to gain access to a specific asset, they must contact another member of the WalrusMC Core Team via email or Discord.
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

const developerPrompt = `
You are the **Reasoning Controller** for Steve, an AI assistant for WalrusMC Events.

Your job is to analyze the user's latest message and take **exactly one** of the following actions, based on the message's complexity and topic.

If the user explicitly specifies a valid GPT model to use ("gpt-5-codex", "gpt-5", or "gpt-5-mini"), then use that model.
Otherwise, use these guidelines to choose a model:

- **gpt-5-codex** → Use for advanced, multi-step coding or plugin development tasks that require reasoning, planning, or multiple code files.
- **gpt-5** → Use for highly technical, highly analytical, or large multi-step reasoning tasks (e.g., automations, system design, complex logic, or deep technical help).
- **gpt-5-mini** → Use for general or moderately complex tasks, code snippets, or informational queries.
- **gpt-5-nano** → Use for short, direct, and simple questions that can be answered conversationally. If the user asks you to do something that you don't have the ability to do, **NEVER** choose "gpt-5-nano" to respond. Instead, choose a different model, as they have access to a broader variety of tools.


Please perform **exactly one** of these actions:
1. If you chose either "gpt-5-codex", "gpt-5", or "gpt-5-mini", call the \`respond\` tool with the model you have selected.
2. Or, if you chose "gpt-5-nano", respond yourself with **less than 2000 characters** of text.

When responding yourself, your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), bold text (**text**), italics (*text*), large text(# text), and more.

Do not explain your reasoning.
Do not call more than one tool.
Do not output anything except your chosen tool call or your final message.
`



const prompt = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt }
];

export async function router(message) {
  if (logAmount === 2) console.log("LOG: Sent initial request to gpt-5-nano");

  // Send request to OpenAI API
  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      ...prompt,
      { role: "user", content: message.content },
    ],
    tools: [{
      type: "function",
      name: "respond",
      description: "Forward the message to a specified GPT model",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", enum: [ "gpt-5-codex", "gpt-5", "gpt-5-mini" ] },
        },
        required: ["model"],
      },
    }],
  });

  if (logResponse && logAmount) console.log(response);

  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  const responseMessage = response.output[1]?.content?.filter?.(c => c.type === "output_text" || c.type === "text");
  const fullResponseMessage = responseMessage?.map?.(c => c.text)?.join?.("\n");

  const sentMessages = [];
  if (toolCall) {
    if (logAmount === 2) console.log("LOG: gpt-5-nano chose to call a different model");

    // Call a different model
    const args = JSON.parse(toolCall.arguments);
    if (toolCall.name === "respond") {
      return await respond(args.model, message);
    } else {
      console.log(`ERR: Incorrect function name: ${toolCall.name}`);
      sentMessages.push(await message.channel.send("Oh no! An error has occured."));
      return sentMessages;
    }
  } else if (fullResponseMessage?.length) {
    if (logAmount === 2) console.log(`LOG: gpt-5-nano chose to send a response of ${response.output_text.length} characters`);

    // Send response message
    if (fullResponseMessage.length < 2001) {
      sentMessages.push(await message.channel.send(fullResponseMessage));
      return sentMessages;
    } else {
      console.log("ERR: Sent over 2000 characters of text");
    }
  } else {
    // Error handling
    sentMessages.push(await message.channel.send("Oh no! An error has occured."));
    console.log(`ERR: GPT did not call a tool or send a valid response!`)
    return sentMessages;
  }

};