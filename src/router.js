import OpenAI from "openai";
import fs from "fs/promises";
import { sendMsgDiscord } from "./tools/sendMsgDiscord.js";
import { createLogger } from "./utils/logger.js";
import { moderate } from "./moderate.js";
import { workflowOrchestrator } from "./complex/workflowOrchestrator.js";

const client = new OpenAI;
const log = createLogger("router");

const systemPrompt = `You are Steve, an AI assistant for Minecraft server owners. You live on Discord and you help users with tasks such as:

• Creating and modifying Minecraft plugins
• Interacting with remote Minecraft servers (Files, commands, logs, configuration)  
• Reading and analyzing Google Docs  
• Brainstorming ideas, explaining concepts, and providing guidance  
• Running multi-step workflows that involve coding, reasoning, planning, or server analysis  

You speak in a friendly, concise, professional tone.  
You respond exactly as Steve would, even when choosing tools.
`;

const developerPrompt = `You are the routing controller for Steve, part of a multi-model architecture.

Your job:
Analyze the currentUserMessage (and any relevant context) and choose exactly ONE tool to call:
- respond()      → For simple messages you can answer directly without using external systems.
- moderate()     → For typical requests involving planning, tool use, code creation/modification, or single-step server operations.
- complex()      → For very difficult or large workflows requiring multi-step reasoning, dependency chains, testing, or multiple server actions.

What the full Steve system CAN DO (through the other models):
- Create, modify, and debug Minecraft plugins
- Read and analyze Google Documents
- Interact with remote Minecraft servers (files, commands, logs, configuration)
- Execute multi-step workflows with reasoning, error correction, and iteration
- Retrieve structured data, brainstorm ideas, and provide step-by-step instructions

What YOU (the router) can do:
- You can respond with plain text and files.
- You can see the user message, past chats, and an assistant memorySummary of the current chat channel.
Never respond yourself IF: 
- If the user request requires real-time or outside information.
- The user request is asking you to do something other than respond with plain text and/or files.

ROUTING RULES (ordered by priority, highest first):

1) complex()  
Use this when:
- The request requires multi-step dependent reasoning  
- OR multiple tool calls  
- OR interactions with multiple server systems  
- OR debugging, testing, or iterative improvement  
Examples:  
“Optimize the server after analyzing logs”,  
“Scan this plugin and fix all issues”,  
“Set up an entire event workflow.”

2) moderate()  
Use this when the request:  
- Involves plugin creation or modification  
- Requires reading, writing, or editing files  
- Requires Google Docs access  
- Needs a single tool use or simple workflow  
- Requires structured planning or step-by-step instructions  
Examples:  
“Make a plugin that…”,  
“Modify this plugin so that…”,  
“Start the server”,  
"Look at this document..."

3) respond()  
Use this when the message:  
- Is conversational, emotional, or informational  
- AND can be answered in ~7 sentences or fewer  
- AND requires no tools and no external data  
Examples:  
“How are you?”,  
“What is PaperMC?”,  
“Explain how chunk loading works.”

Fallback rule:  
If uncertain, choose the MORE complex option (complex > moderate > respond).

Output rules:  
- You MUST call exactly ONE tool: respond(), moderate(), or complex().  
- DO NOT output anything besides the tool call.  
- DO NOT explain your reasoning.  
- DO NOT apologize or claim inability. If something seems hard, route it upward.
- If you ever find yourself about to say “I cannot,” “I don’t have access,” or any similar disclaimer, STOP and instead call the moderate() tool.

`

/**
 * Routes a Discord message to the appropriate model or responds directly.
 * - Uses gpt-5-nano as a lightweight "reasoning controller" to either forward
 *   to a bigger model or answer directly when trivial.
 */
export async function router(info) {
  const { message } = info; // {Object}
  const { pastChats } = info; // [Array]
  const { summary } = info; // "String"
  const { documents } = info; // {Object}
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8")); // {Object}
  const plugins = await fs.readFile(`./db/${message.guildId}/plugins.json`, "utf-8"); // [Array]
  
  log.debug("Router started for message", message.id);


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
        description: "Downloaded files Steve and you (the router) have access to.",
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
    },
    {
      type: "function",
      name: "complex",
    },
  ];


  // Send initial route decision request to OpenAI
  log.debug("Sending routing request to gpt-5-nano");
  log.response("OPENAI INPUT (ROUTER)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${summary}`);
  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: devInput },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput },
    ],
    tools: tools
  });
  log.response("ROUTER RESPONSE", response);

  // Call tools
  const toolCall = response?.output?.find?.(c => c.type === "function_call" || c.type === "tool_call");
  const responseText = response?.output?.[1]?.content?.[0]?.text;
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    switch (toolCall.name) {
      case "respond":
        log.debug("The router chose to respond itself.");
        return sendMsgDiscord(args.responseText, message, args.files);
      case "moderate":
        log.debug("The router evaluated the message as moderately complex");
        return moderate(info);
      case "complex":
        log.debug("The router evaluated the message as complex",);
        return sendMsgDiscord("This message is very complex, and I'm going to send it the Workflow Orchestrator.", message);
      default:
        log.error("The router did not call a valid tool.")
        return await sendMsgDiscord("Oh no! An error has occured.", message);
    }
  } else if (responseText) {
    switch (responseText) {
      case "moderate":
        log.warn("The router returned output text and evaluated the message as moderately complex");
        return moderate(info);
      case "complex":
        log.warn("The router returned output text and evaluated the message as complex",);
        return sendMsgDiscord("This message is very complex, and I'm going to send it the Workflow Orchestrator.", message);
      default:
        log.warn("The router returned output text: sending text to the user.");
        return sendMsgDiscord(responseText, message);
    }
  } else {
    log.error("The router did not call a tool or return output text.");
    return await sendMsgDiscord("Oh no! An error has occured.", message);
  }

};
