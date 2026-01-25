import OpenAI from "openai";
import { models } from "../models.js";
import type { AgentInfo, ToolResult } from "../types.js";
import { prisma } from "../../lib/prisma.js";
import { server } from "../tools/server/server.js";
import { createLogger } from "../utils/logger.js";
import { gdoc } from "../tools/google.js";

const log = createLogger("workflow");
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
- If unsure about what the user is asking, choose clarification and send a clarification message.
- If what the user is requesting is impossible for you to do, choose impossibleUserRequest and send a response explaining why the task is unable to be fulfilled.
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
      content: toolHistory // To include or not to include, that is the question (How will we give results of previous workflows without overloading the model)
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
      "type": "object",
      "description": "Perform a power operation on a remote Minecraft server.",
      "properties": {
        "name": { "type": "string", "const": "serverPower" },
        "signal": { "type": "string", "enum": [ "start", "stop", "restart", "kill" ] },
        "serverId": { "type": "string", "enum": servers.map(obj => obj.id) }
      },
      "required": [ "name", "signal", "serverId" ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "description": "Create a new plugin.",
      "properties": {
        "name": { "type": "string", "const": "createNewPlugin" },
        "pluginName": { "type": "string", "description": "The plugin name. MUST be a valid Java class name." },
        "description": {
          "description": "A description of the plugin to be created.",
          "type": "string"
        },
        "userRequested": {
          "description": "Was the creation of this plugin directly requested by the user (choose true), or did you decide to create this plugin? (choose false)",
          "type": "boolean"
        }
      },
      "required": [ "name", "pluginName", "description", "userRequested" ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "description": "Edit an existing plugin.",
      "properties": {
        "name": { "type": "string", "const": "editPlugin" },
        "pluginName": { "type": "string", "enum": plugins.map(obj => obj.name) },
        "description": {
          "description": "A description of how the plugin should be edited.",
          "type": "string"
        },
        "userRequested": {
          "description": "Did the user directly request that this plugin be edited (choose true), or did you decide to edit this plugin? (choose false)",
          "type": "boolean"
        }
      },
      "required": [ "name", "pluginName", "description", "userRequested" ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "description": "Read a remote Google document.",
      "properties": {
        "name": { "type": "string", "const": "readDoc" },
        "docId": { "type": "string", "enum": gdoc.extractIds(JSON.stringify(userInput + assistantInput)) }
      },
      "required": [ "name", "docId" ],
      "additionalProperties": false
    },
  ]

  // Send request to OpenAI
  log.response(`OPENAI INPUT (WORKFLOW)`, `|TOOLS|\n${JSON.stringify(tasks, null, 2)}\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${assistantInput}`);
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
          "properties": {
            "workflow": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "integer"
                  },
                  "reason": {
                    "type": "string",
                    "description": "A brief description of why you chose this task"
                  },
                  "task": {
                    "anyOf": tasks
                  }
                },
                "required": [ "id", "reason", "task" ],
                "additionalProperties": false
              }
            },
            "impossibleUserRequest": {
              "anyOf": [ { "type": "string" }, { "type": "null" } ],
              "description": "A response to be sent to the user if their request is impossible. Leave this as null unless you are unable to create a workflow for the user request.",
            },
            "clarification": {
              "anyOf": [ { "type": "string" }, { "type": "null" } ],
              "description": "A clarification message to be sent to the user if more information is needed to create a workflow. Leave this as null unless you need to clarify something with the user."
            }
          },
          "required": [ "workflow", "impossibleUserRequest", "clarification" ],
          "additionalProperties": false
        }
      }
    }
  });

  return JSON.parse(response.output_text);
}
