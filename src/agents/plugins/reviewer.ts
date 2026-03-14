










/** IN PROGRESS!!!!!!!!!!!!!! */
// Was working on this then decided to do one thing at a time and go sequentially. 
// Starting with architect -> plugin coder -> reviewer
// Will continue from there 😮‍💨



























import OpenAI from "openai"
import { createLogger } from "../../utils/logger.js";
import { models } from "../../models.js";
import { plugin } from "../../tools/plugin.js";
import type { AgentInfo, ToolResult } from "../../types.js";
import type { PluginDB } from "../../tools/plugin.js";

const client = new OpenAI;
const log = createLogger("pluginReviewer");

const systemPrompt = `You are Steve, an AI assistant who lives on Discord and assists Minecraft server owners. 
You are specifically the plugin reviewer specialist agent, part of Steve, a multi-agent AI assistant for Minecraft server owners.

Rules:
DO NOT use code fences.
ONLY return a tool call.`;

const reviewer = async function(agentInfo: AgentInfo, pluginName: string, isNew: boolean): Promise<ToolResult<string, false>> {

  const devPrompt = isNew 
  ? `Your job is to review the plugin code and create a description of the plugin including commands, permissions, and general functionality. Please refer to your assistant input for the code.` 
  : `Your job is to review the updated plugin code and update the plugin description accordingly. Please refer to your assistant input for the old description and updated code.`;

  // Send request to OpenAI
  log.response(`OPENAI INPUT (reviewer)`, `|TOOLS|\nN/A JSON Schema\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devPrompt}\n|ASSISTANT|\nForgot to log this or hasn't been implemented yet`);
  const response = await client.responses.create({
    model: models.general.low.slow,
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "developer",
        content: devPrompt
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "createPlugin",
        strict: true,
        schema: {
          type: "object"
        }
      }
    }
  });

}