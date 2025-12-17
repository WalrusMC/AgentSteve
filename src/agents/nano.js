import OpenAI from "openai";
import fs from "fs/promises";
import { sendMsgDiscord } from "../tools/sendMsgDiscord.js";
import { createLogger } from "../utils/logger.js";
import { moderate } from "./moderate.js";
import { models } from "../models.js";

const client = new OpenAI;
const log = createLogger("nano");

const systemPrompt = `You are Steve, an AI assistant for Minecraft server owners. You live on Discord and you help users with tasks such as:

• Creating and modifying Minecraft plugins
• Interacting with remote Minecraft servers (Files, commands, logs, configuration)  
• Reading and analyzing Google Docs  
• Brainstorming ideas, explaining concepts, and providing guidance  
• Running multi-step workflows that involve coding, reasoning, planning, or server analysis  

You speak in a friendly, concise, professional tone.  
You respond exactly as Steve would, even when choosing tools.
`;

const developerPrompt = `You are the nano responder for Steve, part of a multi-model architecture.

Your job is to do one of the following:
Respond to the currentUserMessage yourself via the respond() tool.
OR, if the user is asking for something that Steve (as the whole multi-model AI system) can do, but you (as the nano responder) can not do
Forward the user request to the moderate responder via moderate().

What the full Steve system CAN DO (through the other models):
- Create, modify, and debug Minecraft plugins
- Read and analyze Google Documents
- Interact with remote Minecraft servers (files, commands, logs, configuration)
- Execute multi-step workflows with reasoning, error correction, and iteration
- Retrieve structured data, brainstorm ideas, and provide step-by-step instructions

What YOU (the nano responder) can do:
- You can respond with plain text and files and use Discord formatting (bold, italics, inline code, code blocks, emoji).
- You can see the user message, past chats, and an assistant memorySummary of the current chat channel.
Never respond yourself IF: 
- If the user request requires real-time or outside information.
- The user request is asking you to do something other than respond with plain text and/or files.

Output rules:  
- You MUST call exactly ONE tool: respond() or moderate().  
- DO NOT output anything besides the tool call.  
- DO NOT explain your reasoning.  
- DO NOT apologize or claim inability. If something seems hard, call the moderate() tool.
- If you ever find yourself about to say “I cannot,” “I don’t have access,” or any similar disclaimer, STOP and instead call the moderate() tool.

`

/**
 * Nano Responder
 * 
 * Responds to the user message or routes it up to the moderate responder.
 * - Uses gpt-5-nano as a lightweight reasoning controller and responder to either forward
 *   to the moderate responder or answer directly when trivial.
 */
export async function nano(info) {
  const { message } = info; // {Object}
  const { pastChats } = info; // [Array]
  const { summary } = info; // "String"
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8")); // {Object}
  const plugins = await fs.readFile(`./db/${message.guildId}/plugins.json`, "utf-8"); // [Array]
  
  log.debug("Nano responder started for message", message.id);


  // Current User Message
  const attachmentNames = message?.attachments?.size
  ? message.attachments.map(att => att.name)
  : [];
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true
    },
    content: message.content,
    attachments: attachmentNames
  };

  // Inputs
  const userInput = JSON.stringify({
    pastChats: pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2);
  const devInput = JSON.stringify({
    instructions: developerPrompt,
    information: {
      plugins: {
        description: "Plugins the full Steve has access to (through other models).",
        content: plugins
      },
      files: {
        description: "Downloaded files Steve and you (the nano responder) have access to.",
        content: files
      }
    }
  }, null, 2);
  const assistantInput = JSON.stringify({
    memorySummary: summary
  }, null, 2);


  // Tools
  const tools = [
    {
      type: "function",
      name: "respond",
      description: "Respond yourself.",
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
              enum: Object.keys(files),
              description: "The name of the file you wish to send."
            },
          },
        },
        required: ["responseText"],
      },
    },
    {
      type: "function",
      name: "moderate",
    }
  ];


  // Send initial route decision request to OpenAI
  log.debug(`Sending request to ${models.general.low.slow}`);
  log.response("OPENAI INPUT (NANO)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${summary}`);
  const response = await client.responses.create({
    model: models.general.low.slow,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: devInput },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput },
    ],
    tools: tools
  });
  log.response("NANO RESPONSE", response);

  // Call tools
  const toolCall = response?.output?.find?.(c => c.type === "function_call" || c.type === "tool_call");
  const responseText = response?.output?.[1]?.content?.[0]?.text;
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    switch (toolCall.name) {
      case "respond":
        log.debug("The nano responder chose to respond itself.");
        return await sendMsgDiscord(args.responseText, message, args.files);
      case "moderate":
        log.debug("The nano responder decided to forward the message.");
        return await moderate(info);
      default:
        log.error("The nano responder did not call a valid tool.")
        return await sendMsgDiscord("Oh no! An error has occured.", message);
    }
  } else if (responseText) {
    switch (responseText) {
      case "moderate()":
      case "moderate":
        log.warn("The nano responder returned output text and decided to forward the message.");
        return await moderate(info);
      default:
        log.error("The nano responder returned output text. Aborting.");
        return await sendMsgDiscord("Oh no! An error has occured.", message);
    }
  } else {
    log.error("The nano responder did not call a tool or return output text.");
    return await sendMsgDiscord("Oh no! An error has occured.", message);
  }

};
