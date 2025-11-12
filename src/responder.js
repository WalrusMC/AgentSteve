import OpenAI from "openai";
import { createPlugin } from "./tools/createPlugin.js";
import { sendMsgDiscord } from "./tools/sendMsgDiscord.js";
import { getPastChats } from "./utils/getPastChats.js";
import fs from "fs/promises";
import { createLogger } from "./utils/logger.js";
const client = new OpenAI;
const log = createLogger("responder");

const systemPrompt = `You are Steve, an AI assistant for Minecraft server owners and you live on Discord. You assist 
users with development tasks like writing code, creating Minecraft plugins, executing console commands, 
uploading/editing/deleting server files, and answering questions among others. Always be professional, helpful, 
and accurate. Keep your answers concise unless the user asks for detailed guidance or technical depth. For most 
questions, aim for 2-4 short paragraphs or less. Offer to elaborate if needed.

Behavior:
- You may choose to use your assistant (MEMORY SUMMARY) and your user (PAST CHATS) when it is applicable to the current user message, otherwise respond neutrally.
- If uncertain about an event or detail, clarify that information may need verification through official sources.
`;

const developerPrompt = `A reasoning controller for you, Steve, a multi-model AI system Assistant for Minecraft server 
owners, has already chosen to send this user message to you based on user request or complexity of the message. A 
memory summarizer has taken past Discord chats of the current user chat channel and summarized them for you so that 
you know the context of the user input. Should you need to recall exact past chats, you have been sent a few of the 
latest past chats exactly as they are.


Please respond to the **CURRENT USER MESSAGE** with the \`respond\` tool to the best of your ability and use any tools at your disposal that you feel are neccessary.

Your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), bold text (**text**), 
italics (*text*), large text(# text), and more in your response.
`;

/**
 * Sends the user message and context to the selected model and executes any tool calls.
 * Falls back to Discord response on errors.
 */
export async function responder(model, message, summary, assistantMessage = "", extraDeveloperMessage = "", overrideDevMessage = false) {
  log.info(`Responder running with model: ${model}`);

  // Constants
  const files = JSON.parse(await fs.readFile(`./db/${message.guildId}/files.json`, "utf-8"));
  const fileNames = Object.keys(files);
  const pastChats = await getPastChats(message);
  const attachmentNames = message?.attachments?.size
    ? Array.from(message.attachments.values()).map(a => a.name).join(",")
    : "";
  const userInput = `(PAST CHATS)\n${pastChats}\n(CURRENT USER MESSAGE)UTC_TIME:${message.createdAt.toISOString()}|ROLE:ADMINISTRATOR|USERNMAME:${message.author.username}|USER_ID:${message.author.id}|CHAT:${message.content}${attachmentNames ? `|ATTACHMENTS:${attachmentNames}` : ""}\n`;
  let developerFiles = fileNames.length ? "\n\n(FILES YOU HAVE ACCESS TO)\n" : "";
  for (const fileName of fileNames) {
    developerFiles += `${fileName}: ${files[fileName]}\n`;
  }

  // Tools
  const tools = [
    { type: "web_search" },
    {
      type: "function",
      name: "createPlugin",
      description: "Compile and build a Paper 1.20.1 Minecraft plugin (Java 17) into a jar. Keep in mind that the plugin is created with paper 1.20.1.",
      parameters: {
        type: "object",
        properties: {
          pluginJava: { 
            type: "string", 
            description: "The plugin's code. The correct package is: com.walrusmc. ",
          },
          pluginYML: { 
            type: "string", 
            description: "The plugin.yml.",
          },
          configYML: { 
            type: "string", 
            description: "The default config.yml.",
          },
          pluginVersion: { 
            type: "string", 
            description: "The version of the plugin (Like 1.0.0).",
          },
          pluginName: { 
            type: "string", 
            description: "Name of the plugin. Must be a valid Java class name. This becomes the main class filename, the jar filename, and pom.xml artifactId.",
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
          noteToSelf: { 
            type: "string",
            description: `Optional. Information on why it was neccessary to call the tool and insructions to yourself on what to do next.`,
          },
        },
        required: ["pluginJava", "pluginYML", "configYML", "pluginVersion", "pluginName"],
      },
    },
    {
      type: "function",
      name: "respond",
      description: "Respond to the user message.",
      parameters: {
        type: "object",
        properties: {
          responseText: {
            type: "string",
            description: "The textual response that will be sent to the user.",
          },
          files: {
            type: "array",
            description: "Optional. An array of the names of all files to send.",
            items: { 
              type: "string",
              enum: fileNames,
              description: "The name of the file you wish to send."
            },
          },
        },
        required: ["responseText"],
      },
    },
  ]

  // Send request to OpenAI API
  log.response("OPENAI INPUT (RESPONDER)", `|SYSTEM|\n${systemPrompt}\n|DEVELOPER|\n${overrideDevMessage ? overrideDevMessage : developerPrompt + developerFiles + extraDeveloperMessage}\n|USER|\n${userInput}\n|ASSISTANT|\n(MEMORY SUMMARY)\n${summary}\n\n${assistantMessage}`);
  const response = await client.responses.create({
    model: model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "developer", content: overrideDevMessage ? overrideDevMessage : `${developerPrompt}${developerFiles}${extraDeveloperMessage}` },
      { role: "user", content: userInput },
      { role: "assistant", content: `(MEMORY SUMMARY)\n${summary}\n\n${assistantMessage}` },
    ],
    tools: tools
  });
  log.response("RESPONDER RESPONSE", response);

  // Call tools
  const toolCall = response.output.find?.(c => c.type === "function_call" || c.type === "tool_call");
  if (toolCall) {
    const args = JSON.parse(toolCall.arguments);
    switch (toolCall.name) {
      case "createPlugin":
        const result = await createPlugin(args.pluginJava, args.pluginYML, args.configYML, args.pluginVersion, args.pluginName, args?.dependencies, message.guildId);
        if (result.success) {
          files[result.file] = "A Minecraft plugin JAR.";
          await fs.writeFile(`./db/${message.guildId}/files.json`, JSON.stringify(files, null, 2));
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", `(RECENT INFORMATION)\n
            You just chose to call the createPlugin tool in order to answer the CURRENT USER MESSAGE and a plugin JAR has been generated for you: ${result.file}\n\n` );
        } else {
          const ovrdDevMsg = `A reasoning controller for you, Steve, an AI Agent Assistant for WalrusMC Events, 
has already chosen to send this user message to this specific gpt model based on user request or complexity of the message. A memory summarizer has taken past Discord 
chats of the current user chat channel and summarized them for you so that you know the context of the user input. Should you need to recall exact
past chats, you have been sent a few of the latest past chats exactly as they are.


Please respond to the **CURRENT USER MESSAGE** to the best of your ability and use any tools at your disposal that you feel are neccessary.

Your response will be sent on Discord, so feel free to use discord text formatting features like emojis (:emoji_name:), bold text (**text**), 
italics (*text*), large text(# text), and more in your response.

(RECENT INFORMATION)
In order to answer the CURRENT USER MESSAGE, you just chose to call the createPlugin tool and the tool crashed while trying to build the plugin. 
You called the createPlugin tool with these parameters:
----- BEGINNING OF PARAMETERS -----
----- pluginName -----
${args.pluginName}
----- pluginVersion -----
${args.pluginVersion}
----- pluginJava (Main file code) -----
${args.pluginJava}
----- pluginYML (code for the plugin.yml) -----
${args.pluginYML}
----- configYML (code for the config.yml) -----
${args.configYML}
----- dependencies (array of raw text Maven pom.xml <dependency>...</dependency> XML blocks) -----
${args.dependencies}
----- END OF PARAMETERS -----

This is the error Maven threw after crashing:
----- BEGINNING OF MAVEN ERROR REPORT -----
${result.error}
----- END OF MAVEN ERROR REPORT -----
`;
          return await responder(model, message, summary, assistantMessage, extraDeveloperMessage, ovrdDevMsg);
        }
      case "respond":
        return await sendMsgDiscord(args.responseText, message, args.files);
      default:
        log.error("GPT did not call a valid tool.");
        return await sendMsgDiscord("Oh no! An error has occured.", message);
    }

  } else {
    log.error("GPT did not call a tool!");
    return await sendMsgDiscord("Oh no! An error has occured.", message);
  }
};
