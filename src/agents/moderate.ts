import OpenAI from "openai";
import { sendMsgDiscord } from "../tools/sendMsgDiscord.js";
import { coder } from "./coder.js"
import { createLogger } from "../utils/logger.js";
import { gdoc } from "../tools/google.js";
import { models } from "../models.js";
import { server } from "../tools/server.js";
import type { AgentInfo, ResponderResponse, ToolResult } from "../types.js";
import { prisma } from "../../lib/prisma.js";
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
- Always answer the user’s currentUserMessage, not assumptions or past intents.
- Keep answers clear and actionable.
- Be concise by default (1–4 short paragraphs). Expand only if the user asks.
- If the user asks to create or edit a plugin, you must use tools — not free-text.
- If a tool call is necessary to complete the task, do not answer directly. Call the tool.
- If unsure about what the user is asking, ask for clarification via clarify(), not assumptions.
`;

const developerPrompt = `
Your job is to analyze the currentUserMessage, decide what needs to be done,
call tools (if necessary), and then respond to the user via the **respond** tool.

=======================
TOOL USAGE LOGIC
=======================

Determine whether tools are required to fulfill the currentUserMessage. 
Read your assistant toolHistory to determine which tools have already been called.

If tools are NOT needed:
Call the respond tool with the final textual response.

If tools ARE needed:
- Read your assistant toolHistory to determine which tools have already been called.
- If an additional tool call is still required, call exactly ONE tool and wait for its result.
- If no more tool calls are required, call respond().

=======================
BEHAVIOR RULES
=======================
- When all tool work is finished, immediately call respond().
- When uncertain of user intent, request clarification with clarify().
- You may use Discord formatting (bold, italics, inline code, code blocks, emoji)
  inside respond() to improve readability.
`;

/**
 * Sends the user message and context to the selected model and executes any tool calls.
 * Falls back to Discord response on errors.
 */
export async function moderate(info: AgentInfo, toolHistory: ToolResult<any, any>[] = [], devOverride?: string | false): Promise<ResponderResponse> {
  const { message } = info;
  const { pastChats } = info;

  // Downloads
  const downloads = (await prisma.download.findMany({
    where: {
      guildId: info.guildId
    }
  })).map(download => {
    const { id, guildId, ...rest} = download;
    return rest;
  })

  // Plugins
  const plugins = (await prisma.plugin.findMany({
    where: {
      guildId: info.guildId
    }
  })).map(download => {
    const { id, guildId, ...rest} = download;
    return rest;
  });

  // Servers
  const servers = await server.readAndUpdate(message.guildId) // {Object}
  
  log.debug("Moderate started for message", message.id);


  // Current User Message
  const attachmentNames = message?.attachments?.size 
  ? message.attachments.map(att => att.name ?? "UNKNOWN_ATTACHMENT")
  : [];
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true
    },
    content: message.content,
    attachments: attachmentNames,
  };

  // User Input
  const userInput = JSON.stringify({
    pastChats: pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2);

  // Dev Input
  const devInput = !devOverride ? JSON.stringify({
    instructions: developerPrompt,
    information: {
      plugins: {
        description: "Plugins you have access to.",
        content: plugins
      },
      downloads: {
        description: "Downloaded files you have access to.",
        content: downloads
      },
      servers: {
        description: "Remote Minecraft servers you have access to.",
        content: servers
      }
    }
  }, null, 2) : devOverride;

  // Assistant Input
  const assistantInput = JSON.stringify({
    //memorySummary: summary,

    toolHistory: {
      noteToSelf: "These are tools I just called to answer the current user request and their results.",
      ...toolHistory
    }
  }, null, 2);

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
              enum: downloads.map(download => download.file),
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
            description: "The name of the plugin.",
            enum: plugins.map(plugin => plugin.name),
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
    {
      type: "function",
      name: "readDoc",
      description: "Retrieve a Google document's content by its ID.",
      parameters: {
        type: "object",
        properties: {
            ids: {
              type: "array",
              description: "An array of document IDs to retrieve. Only call this tool if you know the document ID.",
              items: {
                type: "string",
                enum: gdoc.extractIds(JSON.stringify(userInput, null, 2)),
                description: "The specific document ID to retrieve."
              }
            }
        },
        required: ["ids"],
      }
    }
  ];

  // Send request to OpenAI API
  log.response("OPENAI INPUT (MODERATE)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${assistantInput}`);
  const response = await client.responses.create({
    model: models.general.medium.slow,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: devInput },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput }
    ],
    tools: tools
  } as any);
  log.response("MODERATE RESPONSE", response);

  // Call tools
  const toolCall = (response as any).output.find?.((c: any) => c.type === "function_call" || c.type === "tool_call");
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    let toolResult;
    switch (toolCall.name) {
      case "respond":
        return {
          messages: await sendMsgDiscord(args.responseText, message, args.files),
          isClarification: false,
          responder: "moderate"
        };
      case "editPlugin":
      case "createNewPlugin":
        toolResult = await coder(toolCall.name, args.pluginName, args.assistantMessage, args.complex ? models.coder.high.slow : models.coder.medium.slow, info);
        if (toolResult.success) {
          // TO DO: Improve the toolResult system (toolResult.result)
          toolHistory.push({ ...toolResult, name: toolCall.name});
          return await moderate(info, toolHistory, devInput);
        } else {
          toolHistory.push({ ...toolResult, name: toolCall.name});
          return await moderate(info, toolHistory, devInput);
        }
      case "clarify":
        return {
          messages: await sendMsgDiscord(args.question, message),
          isClarification: true,
          responder: "moderate"
        };
      case "readDoc":
        // TO DO: Add summarizer for really big documents.
        // TO DO: Fix tool results for document reading capabilities!!!!
        toolResult = await gdoc.read(false, message, args.ids);
        if (toolResult.success) {
          // TO DO: Improve the toolResult system (toolResult.result)
          if (toolResult.result.size > 20000) {
            toolHistory.push({
              name: "readDoc",
              success: false,
              error: `The requested document/documents (${args.ids}) was/were too big. Documents should be a maximum of ~15,000.`
            });
            return await moderate(info, toolHistory, devInput);
          } else {
            toolHistory.push({ name: toolCall.name, success: true, result: toolResult.result.documents});
            return await moderate(info, toolHistory, devInput);
          }
        }
        switch (toolResult.error.reason) {
          case "NO_AUTH":
          case "FORBIDDEN":
            return {
              messages: false,
              isClarification: false,
              responder: "moderate"
            }; // A message is sent to the user explaining how they can grant Steve access to documents from google.js.
          case "NOT_FOUND":
            toolHistory.push({
              name: "readDoc",
              success: false,
              error: `The requested document/documents (${args.ids}) could not be accessed (missing permission, or broken link). Do not try to access that/those document/documents again.`
            });
            return await moderate(info, toolHistory, devInput);
          case "UNKNOWN":
            toolHistory.push({
              name: "readDoc",
              success: false,
              error: `Failed to read the requested document/documents (${args.ids}) due to a Google API/auth error. Do not try this tool again.`
            });
            return await moderate(info, toolHistory, devInput);
          default:
            log.error("gdoc.read() returned invalid data.");
            return {
              messages: await sendMsgDiscord("Oh no! An error has occured.", message),
              isClarification: false,
              responder: "moderate"
            };
          }
      default:
        log.error("GPT did not call a valid tool.");
        return {
          messages: await sendMsgDiscord("Oh no! An error has occured.", message),
          isClarification: false,
          responder: "moderate"
        };
    }
  } else {
    log.error("GPT did not call a tool.");
    return {
      messages: await sendMsgDiscord("Oh no! An error has occured.", message),
      isClarification: false,
      responder: "moderate"
    };
  }
};
