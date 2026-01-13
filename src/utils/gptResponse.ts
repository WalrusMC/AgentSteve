import { createLogger } from "./logger.js";
import { OpenAI } from "openai/client.js";
import { sendMsgDiscord } from "../tools/sendMsgDiscord.js";
import type { Message } from "discord.js";
import { ResponderResponse, Responder } from "../types.js";

const client = new OpenAI;
const log = createLogger("GPT Responses");

export async function gptResponse(responder: Responder, message: Message, model: string, tools: OpenAI.Responses.Tool[], systemPrompt: string, devInput: string, userInput: string, assistantInput: string): 
Promise<{
  success: true,
  toolCall: OpenAI.Responses.ResponseFunctionToolCall
} | {
  success: false,
  return: ResponderResponse
}> {
  // Send request to OpenAI API
  log.response(`OPENAI INPUT (${responder})`, `|TOOLS|\n${JSON.stringify(tools, null, 2)}\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${assistantInput}`);
  const response = await client.responses.create({
    model: model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: devInput },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantInput }
    ],
    tools: tools
  });
  log.response(`${responder.toUpperCase()} RESPONSE`, { model: response.model, output: response.output });

  // Get tool call
  function isFunctionToolCall(
    item: OpenAI.Responses.ResponseOutputItem
  ): item is OpenAI.Responses.ResponseFunctionToolCall {
    return item.type === "function_call";
  }
  const toolCall: OpenAI.Responses.ResponseFunctionToolCall | undefined = response.output.find?.((c: any) => isFunctionToolCall(c));

  // Handle errors
  if (!toolCall) {
    log.error(`(${responder}) GPT did not call a tool.`);
    return {
      success: false,
      return: {
        messages: await sendMsgDiscord("Oh no! An error has occured.", message),
        isClarification: false,
        responder: responder
      }
    };
  } else {
    return {
      success: true,
      toolCall
    }
  }
}