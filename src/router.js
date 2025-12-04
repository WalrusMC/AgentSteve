import OpenAI from "openai";
import fs from "fs/promises";
import { sendMsgDiscord } from "./tools/sendMsgDiscord.js";
import { createLogger } from "./utils/logger.js";
import { moderate } from "./moderate.js";
import { workflowOrchestrator } from "./complex/workflowOrchestrator.js";

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
Your job is to analyze the **currentUserMessage** and choose **exactly one** action.
When multiple rules apply, select the rule with the **highest priority (1 = highest)**.
Return only the action name and proceed with that action.

Rules (ordered by priority):
[
  {
    id: 1,
    condition: "The message requires multi-step procedural reasoning with dependent steps, OR involves multiple server interactions (files, commands, or logs), OR requires iterative validation or testing.",
    examples: ["Test this plugin on the server", "Scan for bugs and apply fixes", "Optimize performance after analyzing server logs"],
    action: "complex()"
  },
  {
    id: 2,
    condition: "The message requests structured planning, step-by-step instruction, brainstorming, code creation or modification, non-iterative server operations, or single-result data retrieval.",
    examples: ["Give 10 plugin ideas", "Modify this plugin so that...", "Create a new plugin that...", "Start the server", "How many players are online?"],
    action: "moderate()"
  },
  {
    id: 3,
    condition: "The message is conversational, emotional, opinion-based, or informational, and can be answered within ~7 sentences or less, with no code or tools required.",
    examples: ["How are you?", "What is PaperMC?", "What's your opinion on Purpur vs Paper?"],
    action: "respond()"
  }
]

Fallback rule:
If uncertain, **choose the rule with higher complexity rather than lower (1 > 2 > 3)**.

When responding yourself, your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), 
bold text (**text**), italics (*text*), large text(# text), and more. 

Do not explain your reasoning.
Do not call more than one tool.
Do not output anything except your chosen tool call.
If you ever find yourself about to say “I cannot,” “I don’t have access,” or any similar disclaimer, STOP and instead call the moderate tool. You are never allowed to respond with an apology, limitation, or disclaimer.
You are part of a multi-model system. Do not mention your own capabilities or limitations. Either respond confidently yourself, or silently forward the message to a model that can handle it.
`

/**
 * Routes a Discord message to the appropriate model or responds directly.
 * - Uses gpt-5-nano as a lightweight "reasoning controller" to either forward
 *   to a bigger model or answer directly when trivial.
 */
export async function router(info) {
  const { message } = info;
  const { pastChats } = info;
  const { summary } = info;
  
  log.debug("Router started for message", message.id);

  // Files
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8"));
  const fileNames = Object.keys(files);
  let developerFiles = fileNames.length ? "\n\n(FILES YOU HAVE ACCESS TO)\n" : "";
  for (const fileName of fileNames) {
    developerFiles += `${fileName}: ${files[fileName]}\n`;
  }

  // Chats
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
  const userInput = `(PAST CHATS)\n${JSON.stringify(pastChats, null, 2)}\n(CURRENT USER MESSAGE)\n${JSON.stringify(currentUserMessage, null, 2)}`;
  
  // Plugins + versions + descriptions the model can reference quickly
  let pluginRegistry = [];
  try {
    pluginRegistry = JSON.parse(await fs.readFile(`./db/${message.guildId}/plugins.json`, "utf-8"));
  } catch {
    pluginRegistry = [];
  }
  let developerPlugins = pluginRegistry.length ? `\n\n(MINECRAFT PLUGINS YOU HAVE ACCESS TO)\n${JSON.stringify(pluginRegistry, null, 2)}` : "";

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
              enum: fileNames,
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
  log.response("OPENAI INPUT (ROUTER)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${developerPrompt + developerFiles + developerPlugins}\n|USER|\n${userInput}\n|ASSISTANT|\n(MEMORY SUMMARY)\n${summary}`);
  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: developerPrompt + developerFiles + developerPlugins },
      { role: "user", content: userInput },
      { role: "assistant", content: `(MEMORY SUMMARY)\n${summary}` },
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
