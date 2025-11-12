import OpenAI from "openai";
import { responder } from "./responder.js";
import { sendMsgDiscord } from "./tools/sendMsgDiscord.js";
import { getPastChats } from "./utils/getPastChats.js";
import fs from "fs/promises";
import { createLogger } from "./utils/logger.js";

const client = new OpenAI;
const log = createLogger("router");

const systemPrompt = `You are Steve, an AI assistant for Minecraft server owners and you live on Discord. You assist 
users with development tasks like writing code, creating Minecraft plugins, executing console commands, 
uploading/editing/deleting server files, and answering questions among others. Always be professional, helpful, 
and accurate. Keep your answers concise unless the user asks for detailed guidance or technical depth. For most 
questions, aim for 2-4 short paragraphs or less. Offer to elaborate if needed.

Behavior:
- You may choose to use your assistant (MEMORY SUMMARY) and your user (PAST CHATS) when it is applicable to the current user message, otherwise respond neutrally.
- If uncertain about an event or detail, clarify that information may need verification through official sources.
`;

const developerPrompt = `
You are the **Reasoning Controller** for a multi-model system, called Steve, an AI assistant for Minecraft server owners. 
A memory summarizer has taken past Discord chats of the current user chat channel and summarized them for you so 
that you know the context of the user input. Should you need to recall exact past chats, you have been sent a 
few of the latest past chats exactly as they are.

Your job is to analyze the **(CURRENT USER MESSAGE)** and take **exactly one** of the following actions, based on the message's complexity and topic.

If the user explicitly specifies a valid GPT model to use ("gpt-5-codex", "gpt-5", or "gpt-5-mini"), then use that model.
Otherwise, use these guidelines to choose a model:

- **gpt-5-codex** → Use for advanced, multi-step coding or plugin development tasks that require reasoning, planning, or multiple code files.
- **gpt-5** → Use for highly technical, highly analytical, or large multi-step reasoning tasks (e.g., automations, system design, complex logic, or deep technical help).
- **gpt-5-mini** → Use for general or moderately complex tasks, code snippets, or informational queries.
- **gpt-5-nano** → Use for short, direct, and simple questions that can be answered conversationally. Do not use if the user is asking you to do something you can't do.
 
Please perform **exactly one** of these actions:
1. If you chose either "gpt-5-codex", "gpt-5", or "gpt-5-mini", call the \`forward\` tool with the model you have selected.
2. Or, if you chose "gpt-5-nano", and you are able to do everything the user asks, call the \`respond\` tool to respond yourself.

When responding yourself, your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), 
bold text (**text**), italics (*text*), large text(# text), and more. 

Do not explain your reasoning.
Do not call more than one tool.
Do not output anything except your chosen tool call.
If you ever find yourself about to say “I cannot,” “I don’t have access,” or any similar disclaimer, STOP and instead call the \`forward\` tool with "gpt-5-mini" unless the user explicitly requested a different model. You are never allowed to respond with an apology, limitation, or disclaimer.
You are part of a multi-model system. Do not mention your own capabilities or limitations. Either respond confidently yourself, or silently forward the message to a model that can handle it.
`

/**
 * Routes a Discord message to the appropriate model or responds directly.
 * - Uses gpt-5-nano as a lightweight "reasoning controller" to either forward
 *   to a bigger model or answer directly when trivial.
 */
export async function router(message, summary) {
  log.debug("Router started for message", message.id);

  // Constants
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8"));
  const fileNames = Object.keys(files);
  const pastChats = await getPastChats(message);
  const attachmentNames = message?.attachments?.size
    ? Array.from(message.attachments.values()).map(a => a.name).join(",")
    : "";
  const userInput = `(PAST CHATS)\n${pastChats}\n(CURRENT USER MESSAGE)UTC_TIME:${message.createdAt.toISOString()}|ROLE:ADMINISTRATOR|USERNMAME:${message.author.username}|USER_ID:${message.author.id}|CHAT:${message.content}${attachmentNames ? `|ATTACHMENTS:${attachmentNames}` : ""}\n`;
  let developerFiles = fileNames.length ? "\n\n(FILES YOU HAVE ACCESS TO)\n" : "";
  for (const fileName of fileNames) {
    developerFiles += `${fileName}: ${files[fileName]}\n`;
  }
  const tools = [
    {
      type: "function",
      name: "forward",
      description: "Forward the message to a specified GPT model.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", enum: [ "gpt-5-codex", "gpt-5", "gpt-5-mini" ] },
        },
        required: ["model"],
      },
    },
    {
      type: "function",
      name: "respond",
      description: "Respond yourself with gpt-5-nano.",
      parameters: {
        type: "object",
        properties: {
          responseText: { 
            type: "string", 
            description: "The textual response that will be sent to the user."},
          files: { 
            type: "array",
            description: "Optional. An array of any files that need to be sent to the user.",
            items: { 
              type: "string",
              enum: fileNames,
              description: "The name of the file you wish to send."
            },
          },
        },
        required: ["responseText"],
      },
    },
  ];

  // Send initial route decision request to OpenAI
  log.debug("Sending routing request to gpt-5-nano");
  log.response("OPENAI INPUT (ROUTER)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${developerPrompt}${developerFiles}\n|USER|\n${userInput}\n|ASSISTANT|\n(MEMORY SUMMARY)\n${summary}`);
  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: developerPrompt + developerFiles },
      { role: "user", content: userInput },
      { role: "assistant", content: `(MEMORY SUMMARY)\n${summary}` },
    ],
    tools: tools
  });
  log.response("ROUTER RESPONSE", response);

  // Call tools
  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    if (toolCall.name === "forward") {
      log.info("Forwarding to model:", args.model);
      return await responder(args.model, message, summary);
    } else if (toolCall.name === "respond") {
      return await sendMsgDiscord(args.responseText, message, args.files);
    } else {
      log.error(`Incorrect function name: ${toolCall.name}`);
      return await sendMsgDiscord("Oh no! An error has occured.", message);
    }
  } else {
    log.error("GPT did not call a tool or send a valid response!");
    return await sendMsgDiscord("Oh no! An error has occured.", message);
  }

};
