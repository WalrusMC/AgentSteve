import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts, pluginSchemas } from "../../prompts.js";
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

export async function reviewer(
  info: AgentInfo,
  request: PluginCreationRequest,
  project: PluginProjectManifest,
  artifact: BuiltPluginArtifact,
): Promise<PluginReviewerResult> {
  // The reviewer runs only after a successful build and writes the human-facing
  // summary that ends up in the plugin database record and final user response.
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request, {
    project,
    artifact,
  });

  log.response("OPENAI INPUT (pluginReviewer)", {
    system: pluginPrompts.sharedSystem,
    developer: pluginPrompts.reviewer.developer,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.general.medium.slow,
      input: [
        { role: "system", content: pluginPrompts.sharedSystem },
        { role: "developer", content: pluginPrompts.reviewer.developer },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: pluginSchemas.reviewer,
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
