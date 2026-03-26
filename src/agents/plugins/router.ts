import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts, pluginSchemas } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type {
  PluginComplexityDecision,
  PluginComplexityTier,
  PluginCreationRequest,
} from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginComplexityRouter");

function scoreToTier(score: number): PluginComplexityTier {
  if (score <= 4) return "simple";
  if (score <= 7) return "medium";
  return "large";
}

export async function router(
  info: AgentInfo,
  request: PluginCreationRequest,
): Promise<PluginComplexityDecision> {
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request);

  log.response("OPENAI INPUT (pluginRouter)", {
    system: pluginPrompts.sharedSystem,
    developer: pluginPrompts.complexityRouter.developer,
    user: userInput,
    assistant: assistantInput,
  });

  const response = await client.responses.create({
    model: models.general.high.slow,
    input: [
      { role: "system", content: pluginPrompts.sharedSystem },
      { role: "developer", content: pluginPrompts.complexityRouter.developer },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput },
    ],
    text: {
      format: pluginSchemas.complexityRouter,
    },
  });

  const parsed = JSON.parse(response.output_text) as {
    score: number;
    tier: PluginComplexityTier;
    reasoning: string;
  };
  const score = Math.max(1, Math.min(10, parsed.score));

  return {
    score,
    tier: scoreToTier(score),
    reasoning: parsed.reasoning,
  };
}
