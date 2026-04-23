import OpenAI from "openai";
import { prisma } from "../../lib/prisma.js";
import { models } from "../models.js";
import { createNewPlugin } from "../pipelines/plugin.js";
import { gdoc } from "../tools/google.js";
import { server } from "../tools/server/server.js";
import { sendMsgDiscord } from "../tools/sendMsgDiscord.js";
import type { AgentInfo, ResponderResponse, ToolResult } from "../types.js";
import { createLogger } from "../utils/logger.js";

const client = new OpenAI();
const log = createLogger("moderate");

const systemPrompt = `You are Steve, a multi-agent system built to assist Minecraft server owners.
You are specifically the moderation and tool-orchestration agent, part of Steve, a multi-agent system.
You live on Discord and help users with:
- Writing new Minecraft Paper plugins
- Code generation
- Minecraft server configuration
- Running console commands
- Manipulating Minecraft server files (upload/edit/delete/etc)
- Understanding logs
- Troubleshooting

Rules:
- Always answer the user's currentUserMessage, not assumptions or past intents.
- Keep answers clear and actionable.
- Be concise by default (1-4 short paragraphs). Expand only if the user asks.
- If the user asks to create a new plugin, you must use tools, not free-text.
- If the user asks to edit an existing plugin, explain that plugin editing is not implemented yet.
- If a tool call is necessary to complete the task, do not answer directly. Call the tool.
- If unsure about what the user is asking, ask for clarification via clarify(), not assumptions.
`;

const createNewPluginToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pluginName: {
      type: "string",
      description: "The plugin name. It must also be a valid Java class name.",
    },
    assistantMessage: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: {
          type: "string",
          description: "One sentence describing the user's main intent.",
        },
        summary: {
          type: "string",
          description: "A short summary of the requested plugin behavior.",
        },
        requirements: {
          type: "array",
          description: "Concrete requirements, constraints, commands, or feature notes from the request.",
          items: {
            type: "string",
          },
        },
      },
      required: ["intent", "summary", "requirements"],
    },
  },
  required: ["pluginName", "assistantMessage"],
} as const;

const developerPrompt = `
Your job is to analyze the currentUserMessage, decide what needs to be done,
call tools if necessary, and then respond to the user via the respond tool.

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
- Use Discord formatting (bold, italics, inline code, code blocks, emojis) inside respond() to improve readability.
- The only plugin-generation tool available here is createNewPlugin for new plugins.
- Do not invent or simulate plugin editing tools.
`;

export async function moderate(
  info: AgentInfo,
  toolHistory: ToolResult<any, any>[] = [],
): Promise<ResponderResponse> {
  const { message, pastChats, guildId } = info;

  const downloads = (
    await prisma.download.findMany({
      where: {
        guildId,
      },
    })
  ).map(download => {
    const { id, guildId: _guildId, ...rest } = download;
    return rest;
  });

  const plugins = (
    await prisma.plugin.findMany({
      where: {
        guildId,
      },
    })
  ).map(pluginRecord => {
    const { id, guildId: _guildId, ...rest } = pluginRecord;
    return rest;
  });

  const servers = await server.readAndUpdate(guildId);
  const serversInformation = servers.map(obj => obj.data);

  log.debug("Moderate started for message", message.id);

  const attachmentNames = message?.attachments?.size
    ? message.attachments.map(att => att.name ?? "UNKNOWN_ATTACHMENT")
    : [];
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true,
    },
    content: message.content,
    attachments: attachmentNames,
  };

  const userInput = JSON.stringify(
    {
      pastChats,
      currentUserMessage,
    },
    null,
    2,
  );

  const devInput = JSON.stringify(
    {
      instructions: developerPrompt,
    },
    null,
    2,
  );

  const assistantInput = JSON.stringify(
    {
      toolHistory: {
        noteToSelf: "These are tools I just called to answer the current user request and their results.",
        content: [...toolHistory],
      },
      resources: {
        noteToSelf: "These are the resources in their current state that I have access to.",
        content: {
          plugins: {
            description: "Plugins I created.",
            content: plugins,
          },
          downloads: {
            description: "Files I downloaded.",
            content: downloads,
          },
          servers: {
            description: "Minecraft servers I have access to.",
            content: serversInformation,
          },
        },
      },
    },
    null,
    2,
  );

  const tools: OpenAI.Responses.Tool[] = [
    { type: "web_search" },
    {
      type: "function",
      name: "respond",
      description: "Respond to the user.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          responseText: {
            type: "string",
            description: "The textual response that will be sent to the user.",
          },
          files: {
            type: "array",
            description: "Optional. Any download files that should be attached in the response.",
            items: {
              type: "string",
              enum: downloads.map(download => download.file),
              description: "The name of the file to send.",
            },
          },
        },
        required: ["responseText", "files"],
      },
      strict: true,
    },
    {
      type: "function",
      name: "createNewPlugin",
      description: "Creates a brand new Paper 1.20.1 Minecraft plugin JAR based on the user's request.",
      parameters: createNewPluginToolSchema,
      strict: true,
    },
    {
      type: "function",
      name: "clarify",
      description: "Clarify something with the user. Only call this if you are unsure about what the user is asking.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: {
            type: "string",
            description: "The text question to be sent to the user.",
          },
        },
        required: ["question"],
      },
      strict: true,
    },
    {
      type: "function",
      name: "readDoc",
      description: "Retrieve a Google document's content by its ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ids: {
            type: "array",
            description: "An array of document IDs to retrieve. Only call this tool if you know the document ID.",
            items: {
              type: "string",
              enum: gdoc.extractIds(userInput),
              description: "The specific document ID to retrieve.",
            },
          },
        },
        required: ["ids"],
      },
      strict: true,
    },
    {
      type: "function",
      name: "serverPower",
      description: "Perform a power operation on a remote Minecraft server.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          signal: {
            type: "string",
            description: "The power operation to perform.",
            enum: ["start", "stop", "restart", "kill"],
          },
          id: {
            type: "string",
            description: "The ID of the remote Minecraft server.",
            enum: servers.map(obj => obj.id),
          },
        },
        required: ["signal", "id"],
      },
      strict: true,
    },
  ];

  log.response("OPENAI INPUT (MODERATE)", {
    tools,
    system: systemPrompt,
    developer: devInput,
    user: userInput,
    assistant: assistantInput,
  });

  const response = await client.responses.create({
    model: models.general.medium.slow,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: devInput },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput },
    ],
    tools,
  });
  log.response("MODERATE RESPONSE", { model: response.model, output: response.output });

  function isFunctionToolCall(
    item: OpenAI.Responses.ResponseOutputItem,
  ): item is OpenAI.Responses.ResponseFunctionToolCall {
    return item.type === "function_call";
  }

  const toolCall = response.output.find?.((item: OpenAI.Responses.ResponseOutputItem) =>
    isFunctionToolCall(item),
  );

  if (!toolCall) {
    log.error("GPT did not call a tool.");
    return {
      messages: await sendMsgDiscord("Oh no! An error has occured.", message),
      isClarification: false,
      responder: "moderate",
    };
  }

  const args = JSON.parse(toolCall.arguments);
  let toolResult;

  switch (toolCall.name) {
    case "respond":
      return {
        messages: await sendMsgDiscord(args.responseText, message, args.files),
        isClarification: false,
        responder: "moderate",
      };
    case "createNewPlugin":
      toolResult = await createNewPlugin(info, args);
      toolHistory.push({ ...toolResult, name: toolCall.name });
      return await moderate(info, toolHistory);
    case "clarify":
      return {
        messages: await sendMsgDiscord(args.question, message),
        isClarification: true,
        responder: "moderate",
      };
    case "readDoc":
      toolResult = await gdoc.read(info.guildId, false, message, args.ids);
      if (toolResult.success) {
        if (toolResult.result.size > 20000) {
          toolHistory.push({
            name: "readDoc",
            success: false,
            error: `The requested document/documents (${args.ids}) was/were too big (${toolResult.result.size}). Documents should be a maximum of ~15,000 characters in total. Here are the individual sizes of each document you requested: ${toolResult.result}`,
          });
          return await moderate(info, toolHistory);
        }

        toolHistory.push({
          name: toolCall.name,
          success: true,
          result: toolResult.result.documents,
        });
        return await moderate(info, toolHistory);
      }

      switch (toolResult.error.reason) {
        case "NO_AUTH":
        case "FORBIDDEN":
          return {
            messages: false,
            isClarification: false,
            responder: "moderate",
          };
        case "NOT_FOUND":
          toolHistory.push({
            name: "readDoc",
            success: false,
            error: `The requested document/documents (${args.ids}) could not be accessed (missing permission, or broken link). Do not try to access that/those document/documents again.`,
          });
          return await moderate(info, toolHistory);
        case "UNKNOWN":
          toolHistory.push({
            name: "readDoc",
            success: false,
            error: `Failed to read the requested document/documents (${args.ids}) due to a Google API/auth error. Do not try this tool again.`,
          });
          return await moderate(info, toolHistory);
        default:
          log.error("gdoc.read() returned invalid data.");
          return {
            messages: await sendMsgDiscord("Oh no! An error has occured.", message),
            isClarification: false,
            responder: "moderate",
          };
      }
    case "serverPower":
      toolResult = await server.power(args.id, args.signal);
      toolHistory.push(
        !toolResult.success
          ? { ...toolResult, error: toolResult.error.reason }
          : toolResult,
      );
      return await moderate(info, toolHistory);
    default:
      log.error("GPT did not call a valid tool.");
      return {
        messages: await sendMsgDiscord("Oh no! An error has occured.", message),
        isClarification: false,
        responder: "moderate",
      };
  }
}
