import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts, pluginSchemas } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type { PluginArchitectResult, PluginCreationRequest, PluginTask } from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginArchitect");

export async function architect(
  info: AgentInfo,
  request: PluginCreationRequest,
): Promise<PluginArchitectResult> {
  // The architect only runs for medium plugins and produces an ordered task plan
  // that the pipeline can hand off to coders one step at a time.
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request);

  log.response("OPENAI INPUT (pluginArchitect)", {
    system: pluginPrompts.sharedSystem,
    developer: pluginPrompts.architect.medium,
    user: userInput,
    assistant: assistantInput,
  });

  try {
    const response = await client.responses.create({
      model: models.general.high.slow,
      input: [
        { role: "system", content: pluginPrompts.sharedSystem },
        { role: "developer", content: pluginPrompts.architect.medium },
        { role: "user", content: userInput },
        { role: "assistant", content: assistantInput },
      ],
      text: {
        format: pluginSchemas.architect,
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
