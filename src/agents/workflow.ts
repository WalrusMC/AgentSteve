import OpenAI from "openai";
import { models } from "../models.js";
import type { AgentInfo, ToolResult } from "../types.js";
import { prisma } from "../../lib/prisma.js";
import { server } from "../tools/server/server.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger();
const client = new OpenAI();

const systemPrompt = `You are Steve, an advanced multi-model AI assistant for Minecraft server owners.
You live on Discord and help users with:
- Writing and editing Minecraft Paper plugins
- Code generation
- Minecraft server management
- Running console commands
- Manipulating Minecraft server files (upload/edit/delete/etc)
- Understanding logs
- Troubleshooting
`;

const developerPrompt = `
You are specifically the Workflow Orchestrator, part of Steve, a larger, multi-model AI system for assisting Minecraft server owners.
Your job is to create a workflow of tasks in order to fulfill the user request. 
Once your workflow is created, it will be automatically executed in full, and a responder agent will analyze the results and respond to the user.

Rules:
- Always answer the user’s currentUserMessage, not assumptions or past intents.
- If unsure about what the user is asking, send a clarification message.
- If what the user is requesting is impossible for you to do, send a response explaining why the task is unable to be fulfilled.
`;

export async function workflow(info: AgentInfo, toolHistory: ToolResult<any, any>[]) {
  const { message } = info;
  const { pastChats } = info;
  const { guildId } = info;

  // Downloads
  const downloads = (await prisma.download.findMany({
    where: {
      guildId: guildId
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
  const servers = await server.readAndUpdate(guildId)
  const serversInformation = servers.map(obj => obj.data);
  
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
    pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2);

  // Dev Input
  const devInput = JSON.stringify({
    instructions: developerPrompt,
    //information: {} // TODO: Information and default plugins and stuff idk
  }, null, 2);

  // Assistant Input
  const assistantInput = JSON.stringify({
    //memorySummary: summary,

    toolHistory: {
      noteToSelf: "These are tools I just called to answer the current user request and their results.",
      content: toolHistory //To include or not to include, that is the question (How will we give results of previous workflows without overloading the model)
    },
    resources: {
      noteToSelf: "These are the resources in their current state that I have access to.",
      content: {
        plugins: {
          description: "Plugins I created.",
          content: plugins
        },
        downloads: {
          description: "Files I downloaded.",
          content: downloads
        },
        servers: {
          description: "Minecraft servers I have access to.",
          content: serversInformation
        }
      }
    }
  }, null, 2);

  const tasks = [
    {
      "description": "Creates a new plugin.",
      "type": "object",
      "properties": {
        "type": { "const": "createNewPlugin" },
        "pluginName": {
          "type": "string",
          "description": "The name of the plugin. MUST be a valid Java class name."
        },
        "pluginDescription": {
          "type": "string",
          "description": "A description of the plugin to be created."
        },
        "userRequested": {
          "type": "boolean",
          "description": "Did the user directly request this plugin?"
        }
      },
      "required": ["type", "pluginName", "pluginDescription", "userRequested"],
      "additionalProperties": false
    },
    {
      "description": "Edits a pre-existing plugin.",
      "type": "object",
      "properties": {
        "type": { "const": "editPlugin" },
        "pluginName": {
          "type": "string",
          "description": "The name of the plugin."
          // TODO: Add enum for plugin names
        },
        "pluginDescription": {
          "type": "string",
          "description": "A description of what needs to be changed on the plugin."
        },
        "userRequested": {
          "type": "boolean",
          "description": "Did the user directly request that this plugin be edited or did you decide to edit this plugin?"
        }
      },
      "required": ["type", "pluginName", "pluginDescription", "userRequested"],
      "additionalProperties": false
    },
    {
      "description": "Reads remote Google Documents.",
      "type": "object",
      "properties": {
        "type": { "const": "readDoc" },
        "documentIds": {
          "type": "array",
          "items": {
            "type": "string",
            // TODO: Add enum for doc IDs maybe
          }
        }
      },
      "required": ["type", "documentIds"],
      "additionalProperties": false
    },
    {
      "description": "Performs a power operation on a remote Minecraft server.",
      "type": "object",
      "properties": {
        "type": { "const": "serverPower" },
        "serverId": {
          "type": "string",
          // TODO: Add enum for server IDs
        },
        "signal": {
          "type": "string",
          "enum": [ "start", "stop", "restart", "kill" ]
        }
      },
      "required": [ "type", "serverId", "signal" ],
      "additionalProperties": false
    }
  ];

  // Send request to OpenAI
  const response = await client.responses.create({
    "model": models.general.low.fast,
    "input": [
      {
        "role": "system",
        "content": systemPrompt
      },
      {
        "role": "developer",
        "content": devInput
      },
      {
        "role": "user",
        "content": userInput
      }
    ],
    "text": {
      "format": {
        "type": "json_schema",
        "name": "response",
        "strict": true,
        "schema": {
          "type": "object",
          "oneOf": [
            {
              "description": "A workflow of tasks to be executed",
              "properties": {
                "type": { "const": "workflow" },
                "tasks": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": { "type": "integer" },
                      "description": {
                        "type": "string",
                        "description": "A brief description of why this task is necessary."
                      },
                      "task": {
                        "description": "The specific tool to execute.",
                        "oneOf": tasks
                      }
                    },
                    "required": ["id", "description", "task"],
                    "additionalProperties": false
                  }
                }
              },
              "required": ["type", "tasks"],
              "additionalProperties": false
            },
            {
              "description": "A textual response sent when the user request is impossible to fulfill",
              "properties": {
                "type": { "const": "impossibleUserRequest" },
                "message": {
                  "type": "string",
                  "description": "Explanation of why the request cannot be fulfilled."
                }
              },
              "required": ["type", "message"],
              "additionalProperties": false
            },
            {
              "description": "A clarification message sent when more information is required",
              "properties": {
                "type": { "const": "clarify" },
                "message": {
                  "type": "string",
                  "description": "Clarification request to send to the user."
                }
              },
              "required": ["type", "message"],
              "additionalProperties": false
            },
          ],
        }
      }
    }
  });

  return JSON.parse(response.output_text);
}
