import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type { PluginArchitectResult, PluginCreationRequest, PluginTask } from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginArchitect");
const systemPrompt = `You are Steve, a multi-agent system built to assist Minecraft server owners.
You are specifically the plugin architecture planning specialist agent, part of Steve, a multi-agent system.
You design Paper 1.20.1 plugin implementation plans.
Return only valid JSON that matches the provided schema.
Do not use markdown fences.
Do not explain your reasoning outside the JSON response.`;

const dependencySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    groupId: { type: "string" },
    artifactId: { type: "string" },
    version: { type: "string" },
    scope: {
      type: "string",
      enum: ["provided", "compile", "runtime"],
    },
  },
  required: ["groupId", "artifactId", "version", "scope"],
} as const;

const repositorySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    url: { type: "string" },
  },
  required: ["id", "url"],
} as const;

const architectSchema = {
  type: "json_schema",
  name: "plugin_architecture",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      isPossible: {
        type: "boolean",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "integer",
              minimum: 1,
              maximum: 20,
            },
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            dependencies: {
              type: "array",
              items: dependencySchema,
            },
            repositories: {
              type: "array",
              items: repositorySchema,
            },
          },
          required: ["id", "title", "description", "dependencies", "repositories"],
        },
      },
    },
    required: ["isPossible", "tasks"],
  },
} as const;

export async function architect(
  info: AgentInfo,
  request: PluginCreationRequest,
): Promise<PluginArchitectResult> {
  // The architect only runs for medium plugins and produces an ordered task plan
  // that the pipeline can hand off to coders one step at a time.
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request);

  log.response("OPENAI INPUT (pluginArchitect)", {
    system: systemPrompt,
    developer: pluginPrompts.architect.medium,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.general.high.slow,
      input: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: pluginPrompts.architect.medium },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: architectSchema,
      },
    });

    const parsed = JSON.parse(response.output_text) as {
      isPossible: boolean;
      tasks: PluginTask[];
    };

    if (!parsed.isPossible) {
      return {
        name: "pluginArchitect",
        success: false,
        error: {
          code: "IMPOSSIBLE",
          message: "The requested plugin is not feasible in the current workflow.",
        },
      };
    }

    if (!Array.isArray(parsed.tasks) || !parsed.tasks.length) {
      return {
        name: "pluginArchitect",
        success: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "The architect did not return any implementation tasks.",
        },
      };
    }

    // Keep execution deterministic even if the model returns tasks out of order.
    const tasks = [...parsed.tasks].sort((a, b) => a.id - b.id);

    return {
      name: "pluginArchitect",
      success: true,
      result: tasks,
    };
  } catch (error) {
    log.error("Architect failed:", error);
    return {
      name: "pluginArchitect",
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The architect returned an invalid response.",
      },
    };
  }
}
