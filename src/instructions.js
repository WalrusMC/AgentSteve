import OpenAI from "openai";
import { forwardMessage } from "./forwardMessage.js";

const client = new OpenAI;

// Prompts
const systemPrompt = `You are Steve, an AI Agent Discord bot with access to a broad variety of tools, built to assist staff on WalrusMC Events 
with the development and production of large-scale Minecraft events.
WalrusMC Events Background Information:
- WalrusMC Events is an organization dedicated towards hosting large-scale Minecraft events, including civilization simulations, hunger games events, zombie apocalypse events, prison simulations, and more!
- WalrusMC Events is working on the development of a civilization-based SMP for the WalrusMC community to play on.
- WalrusMc Events mainly communicates with event participants via a Discord server with over 1,000 members.
- Events are hosted on Java edition Minecraft servers provided by Wepwawet Hosting and usually make use of server software like Purpur.
- Events usually support crossplay (players can connect from Bedrock-edition via GeyserMC) and always include in-game proximity voice chat (proximity voice chat is only available for Java players and is not available for players joining via Bedrock edition)`;

const developerPrompt = `
You are the **Reasoning Controller** for Steve, an AI assistant for WalrusMC Events.

Your job is to analyze the user's latest message and take **exactly one** of the following actions, based on the message's complexity and topic.

If the user explicitly specifies a valid GPT model to use ("gpt-5-codex", "gpt-5", or "gpt-5-mini"), then use that model.
Otherwise, use these guidelines to choose a model:

- **gpt-5-codex** → Use for advanced, multi-step coding or plugin development tasks that require reasoning, planning, or multiple code files.
- **gpt-5** → Use for highly technical, analytical, or multi-step reasoning tasks (e.g., automations, system design, complex logic, or deep technical help).
- **gpt-5-mini** → Use for general or moderately complex tasks, simple code snippets, or informational queries.
- **gpt-5-nano** → Use for short, direct, and simple questions that can be answered conversationally. If the user asks you to do something that you don't have the ability to do, **NEVER** choose "gpt-5-nano" to respond. Instead, choose a different model, as they have access to a broader variety of tools.


Please perform **exactly one** of these actions:
1. If you chose either "gpt-5-codex", "gpt-5", or "gpt-5-mini", call the \`forwardMessage\` tool with the model you have selected.
2. Or, if you chose "gpt-5-nano", respond yourself.

Do not explain your reasoning.
Do not call more than one tool.
Do not output anything except your chosen tool call or your final message.
`



const prompt = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt }
];

// Main function
export async function followInstructions(message) {
  console.log("LOG: running...");
  // Send request to OpenAI API
  const response = await client.responses.create({
    model: "gpt-5-nano",
    input: [
      ...prompt,
      { role: "user", content: message.content },
    ],
    tools: [{
      type: "function",
      name: "forwardMessage",
      description: "Forward the message to a specified GPT model",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", enum: [ "gpt-5-codex", "gpt-5", "gpt-5-mini" ] },
        },
        required: ["model"],
      },
    }],
  });

  // Log response
  console.log(response.output);

  // Get the tool if type = function_call
  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  // Get an array of all output messages
  const responseMessage = response.output[1]?.content?.filter?.(c => c.type === "output_text" || c.type === "text");
  // Chain output messages into one string
  const fullResponseMessage = responseMessage?.map?.(c => c.text)?.join?.("\n");

  if (toolCall) {
    // Call a different model
    const args = JSON.parse(toolCall.arguments);
    if (toolCall.name === "forwardMessage") {
      await forwardMessage(args.model, message);
    } else {
      console.log(`ERR: Incorrect function name: ${toolCall.name}`);
      message.channel.send("Oh no! An error has occured.");
    }
  } else if (fullResponseMessage) {
    // Send response message
    if (fullResponseMessage.length < 2001) {
      await message.channel.send(fullResponseMessage);
    } else {
      // Need to split text
    }
  } else {
    // Error handling
    await message.channel.send("Oh no! An error has occured.");
    console.log(`ERR: GPT did not call a tool or send a valid response!`)
  }

  return true;
};