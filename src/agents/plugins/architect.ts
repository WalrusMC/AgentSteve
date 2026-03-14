import OpenAI from "openai"
import { createLogger } from "../../utils/logger.js";
import type { AgentInfo, ToolResult } from "../../types.js";
import { models } from "../../models.js";
import { addressvalidation } from "googleapis/build/src/apis/addressvalidation/index.js";

const client = new OpenAI;
const log = createLogger("pluginArchitect");

const systemPrompt = `You are Steve, an AI assistant who lives on Discord and assists Minecraft server owners. 
You are specifically the plugin architect agent, part of Steve, a multi-agent AI assistant for Minecraft server owners.

Rules:
DO NOT use code fences.
ONLY return a tool call.`;


export const architect = async function(agentInfo: AgentInfo, pluginName: string, userRequested: boolean): Promise<ToolResult<string, { reason: string, code: "ALREADY_EXISTS" | "IMPOSSIBLE"}>> {
  const { message } = agentInfo;
  const { pastChats } = agentInfo;

  const devPrompt = userRequested //You may use your assistant input to help understand the user intent. #REMOVE copy and paste this back in when we actually have assistant input
  ? `Your job is to design a 1.20.1 Minecraft plugin as requested by the user. 
  Break the plugin request down into 1-15 sequentially ordered, detailed steps. 
  Small plugins might only need a single step, however large plugins that could take tens of thousands of lines to implement might need to be broken down into almost 15 steps.

  Examples:
  - "Create a Minecraft plugin that lets players report each other with a /report command and reports get sent to all staff on the server."
  This plugin is small and will only need one or two steps.

  - "Create a Minecraft plugin that lets players create nations, landclaims, go to war, and have different ranks within nations."
  This plugin is large and will need more than 5 steps.
  `
  : `Your job is to design a 1.20.1 Minecraft plugin as detailed in your assistant input.
  Break the plugin request down into 1-15 detailed steps. 
  Small plugins might only need a single step, however large plugins that could take tens of thousands of lines to implement might need to be broken down into almost 15 steps.

  Examples:
  - "Create a Minecraft plugin that lets players report each other with a /report command and reports get sent to all staff on the server."
  This plugin is small and will only need one or two steps.

  - "Create a Minecraft plugin that lets players create nations, landclaims, go to war, and have different ranks within nations."
  This plugin is large and will need more than 5 steps.`;

  // User input and past chats
  const attachmentNames = message?.attachments?.size 
  ? Array.from(message.attachments.values()).map(a => a.name ?? "").filter(Boolean).join(",")
  : "";
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
  const userInput = userRequested ? JSON.stringify({
    pastChats: pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2) : "";

  // Send request to OpenAI
  log.response(`OPENAI INPUT (pluginArchitect)`, `|TOOLS|\nN/A JSON Schema\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devPrompt}\n|USER|\n${userInput}\n|ASSISTANT|\nForgot to log this or hasn't been implemented yet`);
  const response = await client.responses.create({
    model: models.general.medium.slow, // LEFT OFF- was going to work on architect -> plugin -> reviewer. Just started on architectu and copied and pasted stuff. Need to review and then create architect json schema structure.
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "developer",
        content: devPrompt
      },
      {
        role: "user",
        content: userInput
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "createPlugin",
        strict: true,
        schema: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: {
                    type: "string"
                  },
                  id: {
                    type: "number",
                    enum: [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ]
                  }
                },
                additionalProperties: false,
                required: [ "step", "id" ]
              }
            },
            isPossible: {
              type: "boolean",
              description: "Is the plugin request actually possible?"
            }
          },
          additionalProperties: false,
          required: [ "steps", "isPossible" ]
        }
      }
    }
  });

  const parsedResponse = JSON.parse(response.output_text);

  return parsedResponse.isPossible
  ? {
    name: "pluginArchitect",
    success: true,
    result: JSON.stringify(parsedResponse.steps)
  } : {
    name: "pluginArchitect",
    success: false,
    error: {
      reason: "The plugin architect thinks this plugin is impossible to create.",
      code: "IMPOSSIBLE"
    }
  }

}