import OpenAI from "openai"
import { createLogger } from "../utils/logger.js";
import { plugin } from "../tools/plugin.js";
import type { AgentInfo, ToolResult } from "../types.js";
import type { PluginDB } from "../tools/plugin.js";

const client = new OpenAI;
const log = createLogger("coder");

const systemPrompt = `You are Steve, an AI assistant who lives on Discord and assists Minecraft server owners. 
You are specifically the coding specialist agent, part of Steve, a multi-agent AI assistant for Minecraft server owners.

Rules:
ALWAYS call the tool defined in the developer prompt. 
DO NOT use code fences.
ONLY return a tool call.`;

type Coder = {
  createPlugin(AgentInfo: AgentInfo, model: string, pluginName: string): Promise<ToolResult<string, { reason: string, code: "ALREADY_EXISTS" | "IMPOSSIBLE"}>>;
}

export const coder = {} as Coder;

coder.createPlugin = async function(AgentInfo, model, pluginName) {
  const { message } = AgentInfo;
  const { pastChats } = AgentInfo;

  const devPrompt = `Your job is to create a new Paper 1.20.1 Minecraft plugin called ${pluginName} from the user prompt by calling 
  the **createPlugin** tool. You may use your assisant message to understand the user intent and your past chats to 
  understand the context of the current user message.`;

  // User input and past chats
  const attachmentNames = message?.attachments?.size 
  ? Array.from(message.attachments.values()).map(a => a.name ?? "").filter(Boolean).join(",")
  : "";
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true
    },
    content: message.content,
    attachments: attachmentNames,
  };
  const userInput = JSON.stringify({
    pastChats: pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2);

  // Send request to OpenAI
  log.response(`OPENAI INPUT (coder.createPlugin)`, `|TOOLS|\nN/A JSON Schema\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${assistantInput}`);
  const response = await client.responses.create({
    model: model,
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "developer",
        content: devPrompt
      },
      {
        role: "user",
        content: userInput
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "createPlugin",
        strict: true,
        schema: {
          type: "object",
          properties: {
            pluginDescription: {
              type: "string",
              description: "A 1-5 sentence description of the plugin.",
            },
            pluginJava: {
              type: "array",
              description: `The java code for the plugin.
              Rules:
              - Only output Java 17 compatible Paper 1.20.1 code.
              - Name the class exactly ${pluginName}.
              - Use package: com.walrusmc.${pluginName.toLowerCase()}
              - Include correct imports.
              - The root directory ('/') MUST include a file named ${pluginName}.java
              `,
              items: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                    description: "Where your file should be stored.",
                    enum: [ "/", "config/", "commands/", "storage/", "listeners/", "services/", "models/", "utils/", "hooks/" ]
                  },
                  name: {
                    type: "string",
                    description: "The name of your file. MUST include '.java' at the end."
                  },
                  contents: {
                    type: "string",
                    description: "The code to be included in your file."
                  }
                },
              }
            },
            pluginYML: {
              type: "string",
              description: `The code for plugin.yml. Must include main: com.walrusmc.${pluginName.toLowerCase()}.${pluginName}`,
            },
            configYML: {
              type: "string",
              description: "The code for config.yml.",
            },
            dependencies: { 
              type: "array", 
              description: `Any additional Maven dependency XML blocks to insert inside pom.xml <dependencies>
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
          required: ["pluginJava", "pluginYML", "pluginDescription", "configYML", "dependencies"],
          additionalProperties: false
        }
      }
    }
  });

  

}

/*export async function coder(
  job: CoderJob,
  pluginName: string,
  assistantInput: string,
  model: string,
  info: AgentInfo,
  data?: string,
): Promise<ToolResult<PluginDB, string>> {
  const { message } = info;
  const { pastChats } = info;
  const guildId = message.guildId;
  if (!guildId) throw new Error("Missing guildId on coder message");
  const toolsArray: OpenAI.Responses.Tool[] = [
    { 
      type: "function",
      name: "createNewPlugin",
      description: `Creates a new Paper 1.20.1 Minecraft plugin called ${pluginName}.`,
      parameters: {
        type: "object",
        additionalProperties: false,
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
            type: ["string"],
            description: "Optional (empty string if none). The code for config.yml.",
          },
          dependencies: { 
            type: ["array"], 
            description: `Optional (empty array if none). Additional Maven dependency XML blocks to insert inside pom.xml <dependencies>
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
        required: ["pluginJava", "pluginYML", "pluginDescription", "configYML", "dependencies"],
      },
      strict: true
    },
    {
        type: "function",
        name: "editPlugin",
        description: "Makes changes to a plugin via deletions and insertions. The correct package is com.walrusmc.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pluginDescription: {
              type: ["string"],
              description: "Optional (empty string if none). An updated 1-5 sentence description of the entire plugin. If this is ommitted, the original description will be used.",
            },
            deletions: {
              type: ["array"],
              description: "Optional (empty array if none). An array of sections of the code to delete",
              items: { 
                type: "object",
                additionalProperties: false,
                description: "A specific section of code to delete",
                properties: {
                  file: { type: "string", description: "The target file", enum: ["pluginJava", "pluginYML", "configYML"] },
                  startLine: { type: "integer", description: "The first line to be deleted", minimum: 1 },
                  endLine: { type: "integer", description: "The last line to be deleted", minimum: 1 },
                },
                required: ["file", "startLine", "endLine"],
              },
            },
            insertions: {
              type: ["array"],
              description: "Optional (empty array if none). An array of sections of code to insert",
              items: {
                type: "object",
                additionalProperties: false,
                description: "A specific section of code to insert",
                properties: {
                  file: { type: "string", description: "The target file", enum: ["pluginJava", "pluginYML", "configYML"] },
                  startLine: { type: "integer", description: "The line to insert code after", minimum: 0 },
                  content: { type: "string", description: "The code to be inserted" },
                },
                required: ["file", "startLine", "content"],
              },
            },
            addDependencies: {
              type: ["array"],
              description: `Optional (empty array if none). New Maven dependency XML blocks to insert inside pom.xml <dependencies> 
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
              type: ["array"],
              description: "Optional (empty array if none). An array of dependencies to remove",
              items: { type: "integer", description: "The specific dependency to remove" },
            },
          },
          required: ["pluginDescription", "deletions", "insertions", "addDependencies", "removeDependencies"],
        },
        strict: true
      },
  ];

  let devInput: string;
  let tool: OpenAI.Responses.Tool;

  let dataResult;
  switch (job) {
    case "createNewPlugin":
      devInput = `Your job is to create a new Paper 1.20.1 Minecraft plugin called ${pluginName} from the user prompt by calling 
      the **createNewPlugin** tool. You may use your assisant message to understand the user intent and your past chats to 
      understand the context of the current user message.`;
      tool = toolsArray[0];
      break;
    case "editPlugin":
      dataResult = await plugin.retrieveCode(pluginName, ["pluginJava", "pluginYML", "configYML"], guildId)
      if (dataResult.success) {
        data = JSON.stringify(dataResult.result);
      }
      devInput = `Your job is to edit a Paper 1.20.1 Minecraft plugin called ${pluginName} to fufill the user request by calling 
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
      Here is the plugin code and information:
      ${data}`;
      tool = toolsArray[1];
      break;
    case "fixCrash":
      devInput = `Your job is to fix a Paper 1.20.1 Minecraft plugin called ${pluginName}.
      You may use the user prompt and assistant message to understand the context of the plugin.
      Maven crashed while trying to build this plugin into a JAR. 
      Call the **editPlugin** tool to fix the plugin.

      Here is the plugin information and crash report:
      ${data}`;
      tool = toolsArray[1];
      break;
  }

  if (!devInput || !tool) {
    throw new Error(`Invalid coder job: ${job}`);
  }

  // Tools
  const tools: OpenAI.Responses.Tool[] = [
    { type: "web_search" },
    tool,
  ]

  // User input and past chats
  const attachmentNames = message?.attachments?.size 
  ? Array.from(message.attachments.values()).map(a => a.name ?? "").filter(Boolean).join(",")
  : "";
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true
    },
    content: message.content,
    attachments: attachmentNames,
  };
  const userInput = JSON.stringify({
    pastChats: pastChats,
    currentUserMessage: currentUserMessage
  }, null, 2);

  // Send request to OpenAI
  log.response(`OPENAI INPUT (CODER)`, `|TOOLS|\n${JSON.stringify(tools, null, 2)}\n|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${devInput}\n|USER|\n${userInput}\n|ASSISTANT|\n${assistantInput}`);
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
  log.response(`CODER RESPONSE`, { model: response.model, output: response.output });

  // Get tool call
  function isFunctionToolCall(
    item: OpenAI.Responses.ResponseOutputItem
  ): item is OpenAI.Responses.ResponseFunctionToolCall {
    return item.type === "function_call";
  }
  const toolCall: OpenAI.Responses.ResponseFunctionToolCall | undefined = response.output.find?.((c: any) => isFunctionToolCall(c));

  // Handle errors
  if (!toolCall) {
    log.error(`GPT did not call a tool.`);
    return {
      name: job,
      success: false,
      error: "A critical error has occurred. Do not call this tool again."
    }
  }


  // Execute tool call
  const args = JSON.parse(toolCall.arguments);
  let toolResult;
  switch (toolCall.name) {
    case "createNewPlugin":
      toolResult = await plugin.createNew(pluginName, args.pluginDescription, args.pluginJava, args.pluginYML, args?.configYML, args?.dependencies, guildId);
      if (toolResult.success) {
        return toolResult; // Success
      } else if(toolResult.error.code === "ALREADY_EXISTS") {
        return {
          name: "createNewPlugin",
          success: false,
          error: "The new plugin you tried to create already exists. If you wish to edit a pre-existing plugin, you must call the editPlugin tool, not the createNewPlugin tool."
        }
      } else if(toolResult.error.code === "CRASH") {
        return coder("fixCrash", pluginName, assistantInput, models.coder.high.slow, info, toolResult.error.information);
      } else {
        return {
          name: "createNewPlugin",
          success: false,
          error: "A critical error has occurred. Do not call this tool again."
        }
      }
    case "editPlugin":
      toolResult = await plugin.edit(pluginName, args?.pluginDescription, args?.deletions, args?.insertions, args?.addDependencies, args?.removeDependencies, guildId);
      if (toolResult.success) {
        return toolResult;
      } else if(toolResult.error.code === "CRASH") {
        return coder("fixCrash", pluginName, assistantInput, models.coder.high.slow, info, toolResult.error.information);
      } else {
        return {
          name: "editPlugin",
          success: false,
          error: "A critical error has occurred. Do not call this tool again."
        }
      }
    default:
      log.error("GPT did not call a valid tool.");
      return {
        name: job,
        success: false,
        error: "A critical error has occurred. Do not call this tool again."
      };
  }
}*/

