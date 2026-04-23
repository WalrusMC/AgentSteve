import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type {
  BuiltPluginArtifact,
  PluginCreationRequest,
  PluginProjectManifest,
  PluginReviewerResult,
  PluginReview,
} from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginReviewer");
const systemPrompt = `You are Steve, a multi-agent system built to assist Minecraft server owners.
You are specifically the plugin review and summarization specialist agent, part of Steve, a multi-agent system.
You summarize completed Paper 1.20.1 plugins for server owners.
Return only valid JSON that matches the provided schema.
Do not use markdown fences.
Do not explain your reasoning outside the JSON response.`;
const reviewerSchema = {
  type: "json_schema",
  name: "plugin_review_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
      },
      commands: {
        type: "array",
        items: {
          type: "string",
        },
      },
      permissions: {
        type: "array",
        items: {
          type: "string",
        },
      },
      notes: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["summary", "commands", "permissions", "notes"],
  },
} as const;

export async function reviewer(
  info: AgentInfo,
  request: PluginCreationRequest,
  project: PluginProjectManifest,
  artifact: BuiltPluginArtifact,
): Promise<PluginReviewerResult> {
  /* The reviewer runs only after a successful build and writes the human-facing
   summary that ends up in the plugin database record and final user response. */
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request, {
    project,
    artifact,
  });

  log.response("OPENAI INPUT (pluginReviewer)", {
    system: systemPrompt,
    developer: pluginPrompts.reviewer,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.general.medium.slow,
      input: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: pluginPrompts.reviewer },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: reviewerSchema,
      },
    });

    return {
      name: "pluginReviewer",
      success: true,
      result: JSON.parse(response.output_text) as PluginReview,
    };
  } catch (error) {
    log.error("Reviewer failed:", error);
    return {
      name: "pluginReviewer",
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The reviewer returned an invalid summary.",
      },
    };
  }
}
