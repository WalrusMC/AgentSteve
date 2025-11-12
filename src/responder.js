import OpenAI from "openai";
import { createPlugin } from "./tools/createPlugin.js";
import { ghList, ghRead, ghWrite, ghCreatePR, ghCreateRepo, ghAddCollaborator, ghListInvitations, ghAcceptInvitation } from "./tools/github.js";
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
  const userInput = `(PAST CHATS)\n${pastChats}\n(CURRENT USER MESSAGE)UTC_TIME:${message.createdAt.toISOString()}|ROLE:CORE TEAM|USERNMAME:${message.author.username}|USER_ID:${message.author.id}|CHAT:${message.content}${attachmentNames ? `|ATTACHMENTS:${attachmentNames}` : ""}\n`;
  let developerFiles = fileNames.length ? "\n\n(FILES YOU HAVE ACCESS TO)\n" : "";
  for (const fileName of fileNames) {
    developerFiles += `${fileName}: ${files[fileName]}\n`;
  }
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
      name: "github_list",
      description: "List files/directories at a repo path (uses GitHub REST).",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string", description: 'Path relative to repo root ("" for root).' },
          ref: { type: "string", description: "Optional branch/tag/commit SHA." },
          noteToSelf: { type: "string", description: "Optional follow-up instructions to yourself." },
        },
        required: ["owner", "repo", "path"],
      },
    },
    {
      type: "function",
      name: "github_read",
      description: "Read a text file from a GitHub repo (returns UTF-8).",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          ref: { type: "string", description: "Optional branch/tag/commit SHA." },
          noteToSelf: { type: "string", description: "Optional follow-up instructions to yourself." },
        },
        required: ["owner", "repo", "path"],
      },
    },
    {
      type: "function",
      name: "github_write",
      description: "Create or update a file on a branch in a GitHub repo.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          content: { type: "string", description: "Full file content (UTF-8)." },
          message: { type: "string", description: "Commit message." },
          branch: { type: "string", description: "Branch to write to (must exist)." },
          authorName: { type: "string", description: "Optional commit author name." },
          authorEmail: { type: "string", description: "Optional commit author email." },
          noteToSelf: { type: "string", description: "Optional follow-up instructions to yourself." },
        },
        required: ["owner", "repo", "path", "content", "message", "branch"],
      },
    },
    {
      type: "function",
      name: "github_create_pr",
      description: "Create a pull request between branches in a GitHub repo.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          head: { type: "string", description: "Source branch (e.g., feature)." },
          base: { type: "string", description: "Target branch (e.g., main)." },
          title: { type: "string" },
          body: { type: "string" },
          noteToSelf: { type: "string", description: "Optional follow-up instructions to yourself." },
        },
        required: ["owner", "repo", "head", "base", "title"],
      },
    },
    {
      type: "function",
      name: "github_create_repo",
      description: "Create a new GitHub repository for the authenticated user or an org.",
      parameters: {
        type: "object",
        properties: {
          org: { type: "string", description: "Optional organization name. If omitted, creates under the authenticated user." },
          name: { type: "string", description: "Repository name." },
          description: { type: "string" },
          isPrivate: { type: "boolean", description: "Whether the repo is private (default true)." },
          autoInit: { type: "boolean", description: "Initialize with README (default true)." },
          gitignoreTemplate: { type: "string", description: "Optional .gitignore template name (e.g., Node)." },
          licenseTemplate: { type: "string", description: "Optional license template (e.g., mit)." },
          noteToSelf: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      type: "function",
      name: "github_add_collaborator",
      description: "Invite or add a collaborator to a repository with a permission level.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          username: { type: "string", description: "The GitHub username to add." },
          permission: { type: "string", enum: ["pull", "triage", "push", "maintain", "admin"], description: "Default push." },
          noteToSelf: { type: "string" },
        },
        required: ["owner", "repo", "username"],
      },
    },
    {
      type: "function",
      name: "github_list_invitations",
      description: "List pending repository invitations for the authenticated user.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "github_accept_invitation",
      description: "Accept a repository invitation by ID for the authenticated user.",
      parameters: {
        type: "object",
        properties: {
          invitationId: { type: "number" },
          noteToSelf: { type: "string" },
        },
        required: ["invitationId"],
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
      case "github_list": {
        try {
          const items = await ghList(args.owner, args.repo, args.path || "", args.ref);
          const listing = items.map(i => `${i.type === 'dir' ? 'DIR ' : 'FILE'} ${i.path}`).join("\n");
          const info = `(RECENT INFORMATION)\nGitHub list for ${args.owner}/${args.repo}@${args.ref || 'default'}:${args.path || '/'}\n${listing}\n`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub list failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_read": {
        try {
          const file = await ghRead(args.owner, args.repo, args.path, args.ref);
          const info = `(RECENT INFORMATION)\nRead file ${args.owner}/${args.repo}:${file.path} (sha ${file.sha})\n----- BEGIN FILE CONTENT -----\n${file.content}\n----- END FILE CONTENT -----\n`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub read failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_write": {
        try {
          const out = await ghWrite(args.owner, args.repo, args.path, args.content, args.message, args.branch, args.authorName, args.authorEmail);
          const info = `(RECENT INFORMATION)\nCommitted ${args.owner}/${args.repo}:${out.path} to branch ${out.branch} (commit ${out.commitSha})`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub write failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_create_pr": {
        try {
          const pr = await ghCreatePR(args.owner, args.repo, args.head, args.base, args.title, args.body || "");
          const info = `(RECENT INFORMATION)\nOpened PR #${pr.number} (${pr.url}) from ${pr.head} into ${pr.base}`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub create PR failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_create_repo": {
        try {
          const out = await ghCreateRepo({ org: args.org, name: args.name, description: args.description, isPrivate: args.isPrivate, autoInit: args.autoInit, gitignoreTemplate: args.gitignoreTemplate, licenseTemplate: args.licenseTemplate });
          const info = `(RECENT INFORMATION)\nCreated repo ${out.fullName} (${out.htmlUrl}) private=${out.private} defaultBranch=${out.defaultBranch}`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub create repo failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_add_collaborator": {
        try {
          const out = await ghAddCollaborator(args.owner, args.repo, args.username, args.permission || "push");
          const info = `(RECENT INFORMATION)\nCollaborator ${args.username} ${out.status} on ${args.owner}/${args.repo}`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub add collaborator failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_list_invitations": {
        try {
          const invites = await ghListInvitations();
          const listing = invites.map(i => `#${i.id} ${i.repo}`).join("\n");
          const info = `(RECENT INFORMATION)\nPending invitations for authenticated user:\n${listing || 'None'}`;
          return await responder(model, message, summary, "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub list invitations failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
      }
      case "github_accept_invitation": {
        try {
          const out = await ghAcceptInvitation(args.invitationId);
          const info = `(RECENT INFORMATION)\nAccepted invitation id ${out.id}`;
          return await responder(model, message, summary, args.noteToSelf ? `(NOTE TO SELF)\n${args.noteToSelf}` : "", info);
        } catch (err) {
          const info = `(RECENT INFORMATION)\nGitHub accept invitation failed: ${err?.message || err}`;
          return await responder(model, message, summary, "", info);
        }
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
