import OpenAI from "openai";
import { models } from "../../models.js";
import type { AgentInfo } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { pluginPrompts } from "../../prompts.js";
import { buildPluginAssistantInput, buildPluginUserInput } from "./shared.js";
import type {
  PluginComplexityDecision,
  PluginComplexityTier,
  PluginCreationRequest,
} from "./types.js";

const client = new OpenAI();
const log = createLogger("pluginComplexityRouter");
const systemPrompt = `You are Steve, a multi-agent system built to assist Minecraft server owners.
You are specifically the plugin complexity routing specialist agent, part of Steve, a multi-agent system.
You classify Paper 1.20.1 plugin requests by implementation complexity.
Return only valid JSON that matches the provided schema.
Do not use markdown fences.`;
const complexityRouterSchema = {
  type: "json_schema",
  name: "plugin_complexity_router",
  strict: true,
  "schema": {
    "type": "object",
    "properties": {
      "complexity": {
        "type": "number",
        "enum": [
          0,
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10
        ]
      }
    },
    "additionalProperties": false,
    "required": [
      "complexity"
    ]
  }
} as const;

// The model returns a raw 1-10 score, but the pipeline branches on these three tiers.
function scoreToTier(score: number): PluginComplexityTier {
  if (score <= 4) return "simple";
  if (score <= 7) return "medium";
  return "large";
}

export async function router(
  info: AgentInfo,
  request: PluginCreationRequest,
): Promise<PluginComplexityDecision> {
  // The router sees the same user/request context as the downstream plugin agents,
  // but only decides size and complexity, not implementation details.
  const userInput = buildPluginUserInput(info);
  const assistantInput = buildPluginAssistantInput(request);

  log.response("OPENAI INPUT (pluginRouter)", {
    system: systemPrompt,
    developer: pluginPrompts.complexityRouter,
    user: userInput,
    assistant: assistantInput,
  });

  const response = await client.responses.create({
    model: models.general.high.slow,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: pluginPrompts.complexityRouter },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput },
    ],
    text: {
      format: complexityRouterSchema,
    },
  });

  const parsed = JSON.parse(response.output_text) as {
    complexity: number;
  };
  // Clamp the complexity score so a bad model response cannot push the pipeline outside the expected range.
  const complexity = Math.max(1, Math.min(10, parsed.complexity));

  return {
    tier: scoreToTier(complexity)
  };
}
