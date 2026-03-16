import OpenAI from "openai"
import { createLogger } from "../../utils/logger.js";
import type { AgentInfo, ToolResult } from "../../types.js";
import { models } from "../../models.js";

const client = new OpenAI;
const log = createLogger("pluginArchitect");

const systemPrompt = `You are Steve, an AI assistant who lives on Discord and assists Minecraft server owners. 
You are specifically the plugin architect, part of Steve, a multi-agent AI assistant for Minecraft server owners.`;

type ArchitectDesign = {
  tasks: Tasks
  isPossible: boolean
}

type Tasks = {
  task: string,
  id: number
}[]

export const architect = async function(agentInfo: AgentInfo, pluginName: string, userRequested: boolean): Promise<ToolResult<Tasks, { reason: string, code: "ALREADY_EXISTS" | "IMPOSSIBLE"}>> {
  const { message } = agentInfo;
  const { pastChats } = agentInfo;

  const devPrompt = userRequested //You may use your assistant input to help understand the user intent. #REMOVE copy and paste this back in when we actually have assistant input
  ? `Your job is to design a Minecraft plugin for Paper/Spigot 1.20.1 based on the user’s request.

You must break the plugin into sequential development tasks.
Each task will be implemented by a plugin coding agent.

Your goal is to produce the smallest NUMBER of clear, well-scoped development tasks needed to build the plugin step-by-step. This does NOT mean that the task itself should be small, it means that you should have a small total QUANTITY of tasks.

While you should prioritize less tasks than more, before creating a task think about this: Will a coder agent be able to code this task in one run? If no, then your task is too big and needs to be broken down into more tasks. If yes, then your task is good.




Rules: 

- If you notice that the plugin being requested is not actually reasonably possible to be created, set isPossible as 'false' and leave everything else empty.

- Each individual task should be detailed.

- Do NOT write code.
- Your job is only to design the development plan.

- Tasks must be sequential and build upon previous tasks.
- Tasks should represent major gameplay features or major implementation milestones.
- Avoid creating unnecessary or overly small tasks.


- A task should usually correspond to a meaningful feature set, not a low-level technical layer.
- Do NOT split tasks just because they involve different technical components.

- Each task may include commands, listeners, managers, storage, configuration, messages, and permissions if they belong to the same feature.
- Do NOT create separate tasks just for plugin skeleton, commands, listeners, config, notifications, or integrations unless they are large enough to be major features by themselves.

- Tasks should describe WHAT needs to be implemented, not how to set up the environment or compile the plugin.

For each task include:
- Task Name
- Description
- Extra Dependencies (if required)`
  : `Your job is to design a Minecraft plugin for Paper/Spigot 1.20.1 as detailed in your assistant input.

You must break the plugin into sequential development tasks.
Each task will be implemented by a plugin coding agent.

Your goal is to produce the smallest NUMBER of clear, well-scoped development tasks needed to build the plugin step-by-step. 
This does NOT mean that the task itself should be small, it means that you should have a small total QUANTITY of tasks.

While you should prioritize less tasks than more, before creating a task think about this: Will a coder agent be able to code this task in one run? If no, then your task is too big and needs to be broken down into more tasks. If yes, then your task is good.




Rules: 

- If you notice that the plugin being requested is not actually reasonably possible to be created, set isPossible as 'false' and leave everything else empty.

- Each individual task should be detailed.

- Do NOT write code.
- Your job is only to design the development plan.

- Tasks must be sequential and build upon previous tasks.
- Tasks should represent major gameplay features or major implementation milestones.
- Avoid creating unnecessary or overly small tasks.


- A task should usually correspond to a meaningful feature set, not a low-level technical layer.
- Do NOT split tasks just because they involve different technical components.

- Each task may include commands, listeners, managers, storage, configuration, messages, and permissions if they belong to the same feature.
- Do NOT create separate tasks just for plugin skeleton, commands, listeners, config, notifications, or integrations unless they are large enough to be major features by themselves.

- Tasks should describe WHAT needs to be implemented, not how to set up the environment or compile the plugin.

For each task include:
- Task Name
- Description
- Extra Dependencies (if required)`;

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
    model: models.general.high.slow, 
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
        name: "pluginArchitecture",
        strict: true,
        schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  task: {
                    type: "string"
                  },
                  id: {
                    type: "number",
                    enum: [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ]
                  }
                },
                additionalProperties: false,
                required: [ "task", "id" ]
              }
            },
            isPossible: {
              type: "boolean",
              description: "Is the plugin request actually possible?"
            }
          },
          additionalProperties: false,
          required: [ "tasks", "isPossible" ]
        }
      }
    }
  });

  const parsedResponse: ArchitectDesign = JSON.parse(response.output_text);

  return parsedResponse.isPossible
  ? {
    name: "pluginArchitect",
    success: true,
    result: parsedResponse.tasks
  } : {
    name: "pluginArchitect",
    success: false,
    error: {
      reason: "The plugin architect thinks this plugin is impossible to create.",
      code: "IMPOSSIBLE"
    }
  }

}