import OpenAI from "openai"
import { createLogger } from "../utils/logger.js";
import { getPastChats } from "../utils/getPastChats.js";
import { plugin } from "../tools/plugin.js";
import { models } from "../models.js";

const client = new OpenAI;
const log = createLogger("coder");

const systemPrompt = `You are Steve, an AI assistant who lives on Discord and assists Minecraft server owners. 
You are specifically the coding specialist model, part of Steve, an agentic, multi-model AI assistant for Minecraft server owners.

Rules:
ALWAYS call the tool defined in the developer prompt. 
DO NOT use code fences.
ONLY return a tool call.`;

/**
 * Builds a plugin JAR, then returns:
 * {
 *  success: boolean
 *  file: string
 * }
 * 
 * job = createNewPlugin, editPlugin, fixCrash
 */
export async function coder(job, pluginName, message, assistantMessage, model, info) {
  const toolsArray = [
    { 
      type: "function",
      name: "createNewPlugin",
      description: `Creates a new Paper 1.20.1 Minecraft plugin called ${pluginName}.`,
      parameters: {
        type: "object",
        properties: {
          pluginDescription: {
            type: "string",
            description: "A 1-5 sentence description of the plugin.",
          },
          pluginJava: {
            type: "string",
            description: `The java code for ${pluginName}.java. The correct package is com.walrusmc
            Rules:
            - Only output Java 17 compatible Paper 1.20.1 code.
            - Name the class exactly ${pluginName}.
            - Use package: com.walrusmc.${pluginName.toLowerCase()}
            - Include correct imports.
            `,
          },
          pluginYML: {
            type: "string",
            description: `The code for plugin.yml. Must include main: com.walrusmc.${pluginName.toLowerCase()}.${pluginName}`,
          },
          configYML: {
            type: "string",
            description: "Optional. The code for config.yml",
          },
          dependencies: { 
            type: "array", 
            description: `Optional. Additional Maven dependency XML blocks to insert inside pom.xml <dependencies> 
            (as raw XML). DO NOT include paper-api (1.20.1) or adventure-api (these are already included), but include any other dependencies your code requires. Example format:
            <dependency>
              <groupId>com.github.placeholderapi</groupId>
              <artifactId>placeholderapi</artifactId>
              <version>2.11.5</version>
              <scope>provided</scope>
            </dependency>`, 
            items: { type: "string", description: "A single Maven <dependency>...</dependency> XML block as raw text."},
          },
        },
        required: ["pluginJava", "pluginYML", "pluginDescription"],
      },
    },
    {
        type: "function",
        name: "editPlugin",
        description: "Makes changes to a plugin via deletions and insertions. The correct package is com.walrusmc.",
        parameters: {
          type: "object",
          properties: {
            pluginDescription: {
              type: "string",
              description: "Optional. A new 1-5 sentence description of the plugin. If this is ommitted, the original description will be used.",
            },
            deletions: {
              type: "array",
              description: "An array of sections of the code to delete",
              items: { 
                type: "object",
                description: "A specific section of code to delete",
                properties: {
                  file: { type: "string", description: "The target file", enum: ["pluginJava", "pluginYML", "configYML"] },
                  startLine: { type: "integer", description: "The first line to be deleted" },
                  endLine: { type: "integer", description: "The last line to be deleted" },
                },
                required: ["file", "startLine", "endLine"],
              },
            },
            insertions: {
              type: "array",
              description: "An array of sections of code to insert",
              items: {
                type: "object",
                description: "A specific section of code to insert",
                properties: {
                  file: { type: "string", description: "The target file", enum: ["pluginJava", "pluginYML", "configYML"] },
                  startLine: { type: "integer", description: "The line to insert code after" },
                  content: { type: "string", description: "The code to be inserted" },
                },
                required: ["file", "startLine", "content"],
              },
            },
            addDependencies: {
              type: "array",
              description: `New Maven dependency XML blocks to insert inside pom.xml <dependencies> 
              (as raw XML). Example format:
              <dependency>
                <groupId>com.github.placeholderapi</groupId>
                <artifactId>placeholderapi</artifactId>
                <version>2.11.5</version>
                <scope>provided</scope>
              </dependency>`,
              items: { type: "string", description: "The specific Maven dependency block to add." },
            },
            removeDependencies: {
              type: "array",
              description: "An array of dependencies to remove",
              items: { type: "integer", description: "The specific dependency to remove" },
            },
          },
        },
      },
  ];

  let developerPrompt;
  let tool;
  switch (job) {
    case "createNewPlugin":
      developerPrompt = `Your job is to create a new Paper 1.20.1 Minecraft plugin called ${pluginName} from the user prompt by calling 
      the **createNewPlugin** tool. You may use your assisant message to understand the user intent and your past chats to 
      understand the context of the current user message.`;
      tool = toolsArray[0];
      break;
    case "editPlugin":
      info = await plugin.retrieveCode(pluginName, ["pluginJava", "pluginYML", "configYML"], message.guildId);
      developerPrompt = `Your job is to edit a Paper 1.20.1 Minecraft plugin called ${pluginName} to fufill the user request by calling 
      using the **editPlugin** tool. You may use your assistant message to understand the user intent and your past chats to 
      understand the context of the current user message.
      Rules:
      1. Never rewrite the entire file.
      2. Only modify the specific lines required to implement the user request.
      3. Do NOT change formatting, imports, indentation, naming, comments, or reorder code unless required for correctness.
      4. Before calling editPlugin, think about:
        - Which lines are affected?
        - What minimal changes are needed?

      The plugin code is represented by an array of objects [{ line: number, content: string }]
      Here is the plugin code:
      ${info}`;
      tool = toolsArray[1];
      break;
    case "fixCrash":
      developerPrompt = `Your job is to fix a Paper 1.20.1 Minecraft plugin called ${pluginName}.
      You may use the user prompt and assistant message to understand the context of the plugin.
      Maven crashed while trying to build this plugin into a JAR. 
      Call the **editPlugin** tool to fix the plugin.
      ${info}`;
      tool = toolsArray[1];
      break;
  }

  // Tools
  const tools = [
    { type: "web_search" },
    tool,
  ]

  // User input and past chats
  const pastChats = await getPastChats(message);
  const attachmentNames = message?.attachments?.size 
  ? Array.from(message.attachments.values()).map(a => a.name).join(",")
  : "";
  const userInput = `(PAST CHATS)\n${pastChats}\n(CURRENT USER MESSAGE)UTC_TIME:${message.createdAt.toISOString()}|ROLE:ADMINISTRATOR|USERNMAME:${message.author.username}|USER_ID:${message.author.id}|CHAT:${message.content}${attachmentNames ? `|ATTACHMENTS:${attachmentNames}` : ""}\n`;

  // Send request to OpenAI API
  log.response("OPENAI INPUT (CODER)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${developerPrompt}\n|USER|\n${userInput}\n|ASSISTANT|\n${JSON.stringify(assistantMessage, null, 2)}`);
  const response = await client.responses.create({
    model: model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: developerPrompt },
      { role: "user", content: userInput },
      { role: "assistant", content: JSON.stringify(assistantMessage, null, 2) },
    ],
    tools: tools
  });
  log.response("CODER RESPONSE", response);

  // Call tools
  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    let data;
    switch (toolCall.name) {
      case "createNewPlugin":
        data = await plugin.createNew(pluginName, args.pluginDescription, args.pluginJava, args.pluginYML, args?.configYML, args?.dependencies, message.guildId);
        if (data.success) {
          return data;
        } else {
          return coder("fixCrash", pluginName, message, assistantMessage, models.coder.high.slow, plugin.crashReport(pluginName, data.version, data.code, data.error));
        }
      case "editPlugin":
        data = await plugin.edit(pluginName, args?.pluginDescription, args?.deletions, args?.insertions, args?.addDependencies, args?.removeDependencies, message.guildId);
        if (data.success) {
          return data;
        } else {
          return coder("fixCrash", pluginName, message, assistantMessage, models.coder.high.slow, plugin.crashReport(pluginName, data.version, data.code, data.error));
        }
      default:
        log.error("GPT did not call a valid tool.");
        return {
          success: false,
          error: "GPT did not call a valid tool",
        };
    }
  } else {
    log.error("GPT did not call a tool.");
    return {
      success: false,
      error: "GPT did not call a tool",
    };
  }

}
