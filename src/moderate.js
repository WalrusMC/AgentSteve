import OpenAI from "openai";
import fs from "fs/promises";
import { sendMsgDiscord } from "./tools/sendMsgDiscord.js";
import { coder } from "./specialistModels/coder.js"
import { createLogger } from "./utils/logger.js";
const client = new OpenAI;
const log = createLogger("moderate");

const systemPrompt = `You are Steve, an advanced multi-model AI assistant for Minecraft server owners.
You live on Discord and help users with:
- Writing and editing Minecraft Paper plugins
- Code generation
- Minecraft server configuration
- Running console commands
- Manipulating Minecraft server files (upload/edit/delete/etc)
- Understanding logs
- Troubleshooting

Rules:
- Always answer the user’s CURRENT MESSAGE, not assumptions or past intents.
- Keep answers clear and actionable.
- Be concise by default (1–4 short paragraphs). Expand only if the user asks.
- If the user asks to create or edit a plugin, you must use tools — not free-text.
- If a tool call is necessary to complete the task, do not answer directly. Call the tool.
- If unsure about what the user is asking, ask for clarification via clarify(), not assumptions.
`;

const developerPrompt = `
Your job is to analyze the CURRENT USER MESSAGE, decide what needs to be done,
call tools (if necessary), and then respond to the user via the **respond** tool.

=======================
TOOL USAGE LOGIC
=======================

Determine whether tools are required to fulfill the CURRENT USER MESSAGE.

If tools are NOT needed:
Call the respond tool with the final textual response.

If tools ARE needed:
Read the TOOL HISTORY to understand which tools have already been executed.
- If a required tool call already appears in TOOL HISTORY with "status: success", DO NOT call that tool again.
- If an additional tool call is still required, call exactly ONE tool and wait for its result.
- If no more tool calls are required, call respond().

=======================
BEHAVIOR RULES
=======================
- Never call a tool that already succeeded in TOOL HISTORY.
- When all tool work is finished, immediately call respond().
- When uncertain of user intent, request clarification with clarify().
- You may use Discord formatting (bold, italics, inline code, code blocks, emoji)
  inside respond() to improve readability.
`;

/**
 * Sends the user message and context to the selected model and executes any tool calls.
 * Falls back to Discord response on errors.
 */
export async function moderate(info, toolHistory = []) {
  const { message } = info;
  const { summary } = info;
  const { pastChats } = info;

  log.info(`Moderate responder just started.`);

  // Tool History
  const assistantToolHistory = toolHistory?.length ? `\n\n(TOOL HISTORY)\n${JSON.stringify(toolHistory, null, 2)}` : "";

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

  // Files
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8"));
  const fileNames = Object.keys(files);
  let developerFiles = fileNames.length ? "\n\n(FILES YOU HAVE ACCESS TO)\n" : "";
  for (const fileName of fileNames) {
    developerFiles += `${fileName}: ${files[fileName]}\n`;
  }

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
    { type: "web_search" },
    {
      type: "function",
      name: "respond",
      description: "Respond to the user.",
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
      name: "createNewPlugin",
      description: "Creates a brand new Paper 1.20.1 Minecraft plugin JAR based on user request.",
      parameters: {
        type: "object",
        properties: {
          pluginName: {
            type: "string",
            description: "The name of the plugin. MUST be a valid Java class name."
          },
          assistantMessage: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                description: "A one sentence description of the user intent. Example: Create a combat timer plugin."
              },
              summary: {
                type: "string",
                description: "A 1-2 sentence summary of the plugin. Example: Players enter 15s combat when hitting another player."
              },
            },
            required: ["intent", "summary"],
          },
          complex: {
            type: "boolean",
            description: `
              Set to true ONLY if the requested plugin requires advanced logic, multiple features,
              external systems, complex event handling, data storage, custom UI, networking,
              multistep gameplay mechanics, or integrations with other plugins/APIs.
              Otherwise, set to false.

              Examples of NOT complex (false):
              - Single event trigger and response (join message, ban on death, give item)
              - One listener, command, or config value
              - Simple condition checks

              Examples of complex (true):
              - Multiple interacting systems or features
              - Persistent data, databases, or serialization
              - Custom GUI, menus, scoreboards, placeholders, or NMS
              - Multi-class architecture, services, or async tasks
              - Plugin integrations (PlaceholderAPI, LuckPerms, Discord, economy)
              - Minigame logic, timers, state machines, or world management
            `,
          },
        },
      },
      required: ["pluginName", "assistantMessage", "complex"],
    },
    {
      type: "function",
      name: "editPlugin",
      description: "Edits a pre-existing Paper 1.20.1 Minecraft plugin JAR based on user request.",
      parameters: {
        type: "object",
        properties: {
          pluginName: {
            type: "string",
            description: "The name of the plugin. MUST be a valid Java class name.",
            enum: pluginRegistry.map(obj => obj.name),
          },
          assistantMessage: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                description: "A one sentence description of the user intent. Example: Create a combat timer plugin."
              },
              summary: {
                type: "string",
                description: "A 1-2 sentence summary of the plugin. Example: Players enter 15s combat when hitting another player."
              },
            },
            required: ["intent", "summary"],
          },
          complex: {
            type: "boolean",
            description: `
              Set to true ONLY if the requested plugin requires advanced logic, multiple features,
              external systems, complex event handling, data storage, custom UI, networking,
              multistep gameplay mechanics, or integrations with other plugins/APIs.
              Otherwise, set to false.

              Examples of NOT complex (false):
              - Single event trigger and response (join message, ban on death, give item)
              - One listener, command, or config value
              - Simple condition checks

              Examples of complex (true):
              - Multiple interacting systems or features
              - Persistent data, databases, or serialization
              - Custom GUI, menus, scoreboards, placeholders, or NMS
              - Multi-class architecture, services, or async tasks
              - Plugin integrations (PlaceholderAPI, LuckPerms, Discord, economy)
              - Minigame logic, timers, state machines, or world management
            `,
          },
        },
      },
      required: ["pluginName", "assistantMessage", "complex"],
    },
    {
      type: "function",
      name: "clarify",
      description: "Clarify something with the user. Only call this if you are unsure about what the user is asking.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The text question to be sent to the user.",
          }
        },
      },
      required: ["question"],
    },
  ];

  // Send request to OpenAI API
  log.response("OPENAI INPUT (MODERATE)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${developerPrompt + developerFiles + developerPlugins}\n|USER|\n${userInput}\n|ASSISTANT|\n(MEMORY SUMMARY)\n${summary}${assistantToolHistory}`);
  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: developerPrompt + developerFiles + developerPlugins },
      { role: "user", content: userInput },
      { role: "assistant", content: `(MEMORY SUMMARY)\n${summary}${assistantToolHistory}` },
    ],
    tools: tools
  });
  log.response("MODERATE RESPONSE", response);

  // Call tools
  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    let data;
    switch (toolCall.name) {
      case "respond":
        return await sendMsgDiscord(args.responseText, message, args.files);
      case "editPlugin":
      case "createNewPlugin":
        data = await coder(toolCall.name, args.pluginName, message, args.assistantMessage, args.complex ? "gpt-5.1-codex" : "gpt-5.1-codex-mini");
        if (data.success) {
          files[data.file] = "A Minecraft plugin JAR.";
          await fs.writeFile(`./db/${message.guildId}/files.json`, JSON.stringify(files, null, 2));
          toolHistory.push({
            tool: toolCall.name,
            status: "success",
            result: data.file
          });
          return moderate(info, toolHistory);
        } else {
          toolHistory.push({
            tool: toolCall.name,
            status: "fail",
            result: data.error
          });
          return moderate(info, toolHistory);
        }
      case "clarify":
        await sendMsgDiscord(args.question, message);
        return {
          clarify: true,
          type: "moderate"
        };
      default:
        log.error("GPT did not call a valid tool.");
        return await sendMsgDiscord("Oh no! An error has occured.", message);
    }
  } else {
    log.error("GPT did not call a tool.");
    return await sendMsgDiscord("Oh no! An error has occured.", message);
  }
};
