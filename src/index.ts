import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField, MessageFlags, Message } from "discord.js";
import { router } from "./router.js";
//import { summarizer } from "./agents/summarizer.js";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "./utils/logger.js";
import { isUserAllowed, allowUser, allowRole, disallowUser, disallowRole } from "./utils/whitelist.js"; // Move from role and user-based permissions to server administrator-based perms
import { ensureDBs } from "./utils/ensureDBs.js";
import { moderate } from "./agents/moderate.js";
import { getPastChats } from "./utils/getPastChats.js";
import { gdoc } from "./tools/google.js";

import type { AgentInfo, ResponderResponse, ToolResult } from "./types.js";

// Logger scoped to the Discord bot entrypoint
const log = createLogger("index");
const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Create Discord client with the intents Steve requires to read messages and reply
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessagePolls
  ]
});

// Define slash commands with subcommands for user/role management
const commands = [
  {
    name: "allow",
    description: "Whitelist a user or role to use Steve",
    options: [
      { type: 1, name: "user", description: "Allow a user", options: [ { type: 6, name: "target", description: "User to allow", required: true } ] },
      { type: 1, name: "role", description: "Allow a role", options: [ { type: 8, name: "target", description: "Role to allow", required: true } ] },
    ],
  },
  {
    name: "disallow",
    description: "Remove a user or role from the whitelist",
    options: [
      { type: 1, name: "user", description: "Disallow a user", options: [ { type: 6, name: "target", description: "User to disallow", required: true } ] },
      { type: 1, name: "role", description: "Disallow a role", options: [ { type: 8, name: "target", description: "Role to disallow", required: true } ] },
    ],
  },
];

/**
 * On Bot Startup
 * Register Commands
 * Ensure Databases Are Created
 */
client.once("clientReady", async (readyClient) => {
  log.info(`Ready! Logged in as ${readyClient.user.tag}`);
  // Ensure commands exist in all guilds the bot is currently in
  try {
    for (const g of readyClient.guilds.cache.values()) {
      await ensureDBs(g.id);
      await g.commands.set(commands);
    }
  } catch (e: unknown) {
    log.error("Failed to register commands or create databases on ready:", getErrorMessage(e));
  }

  await fs.writeFile("./db/guilds.json", JSON.stringify(client.guilds.cache.map(guild => guild.id), null, 2));

});

/**
 * On Guild Join
 * Register commands
 * Create databases
 */
client.on("guildCreate", async guild => {
  await ensureDBs(guild.id);
  await guild.commands.set(commands);
  let guildIds = [];
  try {
    guildIds = JSON.parse(await fs.readFile("./db/guilds.json", "utf8"));
  } catch {
    guildIds = [];
  }

  if (!guildIds.includes(guild.id)) {
    guildIds.push(guild.id);
  }

  await fs.writeFile("./db/guilds.json", JSON.stringify(guildIds, null, 2));

  log.info(`Registered commands in guild ${guild.id}`);
});

// Login
client.login(process.env.DISCORD_TOKEN);

const clarifications: Record<string, string> = {};
const currentlyRunning: Record<string, boolean> = {};

client.on("messageCreate", async (message) => {
  // Exit if the author is a bot, pinged everyone, or didn't mention Steve
  if (message.author.bot || message.mentions.everyone || !message.guildId) return;
  if (!client.user || !message.mentions.has(client.user)) return;
  if (!message.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) return await message.reply(":warning: You don't have permission to talk to me right now. Server administrators can give users permission by doing /allow {user}.");
  if (currentlyRunning[`${message.guildId}`]) return await message.reply("Slow down there! I can only answer one question at a time.");

  const info: AgentInfo = {
    message,
    pastChats: await getPastChats(message, 2100)
  }
  const toolHistory: ToolResult[] = [];
  currentlyRunning[`${message.guildId}`] = true;

  let typingInterval: NodeJS.Timeout | undefined;
  try {
    log.debug("User pinged Steve and has correct permissions");

    // Make bot show typing while generating a response
    log.debug("Started typing");
    await message.channel.sendTyping();
    typingInterval = setInterval(() => {
      log.debug("Continuing typing indicator");
      if (!message.guildId || !currentlyRunning?.[message.guildId]) {
        clearInterval(typingInterval);
      } else {
        message.channel.sendTyping();
      }
    }, 9000);

    // If the user attached files, download and index them for tool access
    try {
      if (message.attachments?.size) {
        log.info(`Found ${message.attachments.size} attachment(s); downloading...`);
        const storedDir = path.join(process.cwd(), "src", "tools", "downloads", message.guildId);
        try { await fs.mkdir(storedDir, { recursive: true }); } catch {}

        const downloadsIndexPath = path.join(process.cwd(), "db", message.guildId, "downloads.json");
        let downloadsIndex: Record<string, string> = {};
        try {
          downloadsIndex = JSON.parse(await fs.readFile(downloadsIndexPath, "utf8"));
        } catch {}

        const getUniqueName = async (dir: string, baseName: string) => {
          const safe = baseName.replace(/[\\/]/g, "_");
          let attempt = 0;
          let candidate = safe;
          const [name, ext] = (() => {
            const idx = safe.lastIndexOf(".");
            return idx > 0 ? [safe.slice(0, idx), safe.slice(idx)] : [safe, ""];
          })();
          while (true) {
            try {
              await fs.access(path.join(dir, candidate));
              attempt += 1;
              candidate = `${name}-${attempt}${ext}`;
            } catch {
              return candidate;
            }
          }
        };

        for (const att of message.attachments.values()) {
          try {
            const res = await fetch(att.url);
            if (!res.ok) throw new Error(`Failed to download: ${att.url} (${res.status})`);
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const fileName = await getUniqueName(storedDir, att.name || "upload");
            await fs.writeFile(path.join(storedDir, fileName), buffer);
            downloadsIndex[fileName] = `User-uploaded file from @${message.author.username} (${message.author.id}) at ${new Date().toISOString()}`;
            log.info(`Saved attachment as ${fileName}`);
          } catch (err: unknown) {
            log.error("Failed to save attachment:", getErrorMessage(err));
          }
        }
        await fs.writeFile(downloadsIndexPath, JSON.stringify(downloadsIndex, null, 2));
      }
    } catch (err: unknown) {
      log.error("Attachment handling failed:", getErrorMessage(err));
    }

    // Documents
    // TO DO: Improve the toolResult system (toolResult.result)
    const readDocResult: ToolResult = message.content.includes("https://docs.google.com/document/d/") ? await gdoc.read(message.content, message) : { name: "readDoc", success: false, result: { status: "NO_DOCS" }, code: 204 };
    switch (readDocResult.result) {
      case "FORBIDDEN":
      case "NO_AUTH":
        return; // Message is sent to user on how they can authorize Steve to access Doc.
      case "NOT_FOUND":
        readDocResult.result = "Document not found or inaccessible (missing permission, or broken link).";
        break;
    }
    if (readDocResult.success) {
      if (readDocResult.metaData.size > 20000) {
        // TO DO: Document summarizer (Feed sections of document to GPT nano)
        if (readDocResult.result.length > 1) return await message.reply("Those documents are too big for me to read! Try sending me a single, smaller document.");
        return await message.reply("That document is too big for me to read! Try sending me a smaller one. (< 15,000 characters)");
      } else if (readDocResult.metaData.size > 5000) {
        // TO DO: Rate limit big documents
      }
    }
    if (readDocResult.code !== 204 && readDocResult.code !== 404) toolHistory.push({ ...readDocResult, name: "readDoc" });

    /*
    // Summaries - TO DO: Completely redesign summaries
    let summaries = {};
    try {
      summaries = JSON.parse(await fs.readFile(`./db/${message.guildId}/summaries.json`, "utf8"));
    } catch (err) {
      log.warn("Failed to read summaries file:", err?.message || err);
    }
    info.summary = summaries?.[message.channel.id] ? summaries[message.channel.id] : "NO PAST SUMMARIZATION FOUND!";
    */

    // Forward to router, or skip the router if the last message was a clarification message.
    let responderResponse: ResponderResponse;
    switch (clarifications?.[message.guildId]) {
      case "moderate":
        responderResponse = await moderate(info, toolHistory);
        break;
      case "complex":
        // TO DO: Create complex responder (workflow orchestrator, etc)
        responderResponse = {
          messages: [await message.reply("Placholder for complex responder")],
          isClarification: false,
          responder: "complex"
        }
        break;
      default:
        responderResponse = await router(info, toolHistory);
        break;
    }

    // Check if message was a clarification message and remove embeds
    
    if (responderResponse.isClarification) {
      clarifications[message.guildId] = responderResponse.responder;
    } else if (responderResponse.messages) {
      for (const msg of responderResponse.messages) {
        try {
          log.debug("Suppressing embeds for sent message");
          msg.suppressEmbeds(true);
        } catch (err: unknown) {
          log.debug("Failed to suppress embeds:", getErrorMessage(err));
        }
      }
    }
  } catch (err) {
    log.error("Message handler failed:", getErrorMessage(err));
    try { await message.reply("Sorry, I hit an error while handling that."); } catch {}
  } finally {
    log.debug("Cleared typing interval");
    if (typingInterval) clearInterval(typingInterval);
    currentlyRunning[`${message.guildId}`] = false;
  }
});

// Slash command handler for allow/disallow
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guildId) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }
    const cmd = interaction.commandName;
    const sub = interaction.options.getSubcommand(false);

    // Only users with Manage Server or Admin can edit whitelist
    const hasPerm = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if ((cmd === "allow" || cmd === "disallow") && !hasPerm) {
      return interaction.reply({ content: "You need Manage Server permission to use this.", flags: MessageFlags.Ephemeral });
    }

    if (cmd === "allow") {
      if (sub === "user") {
        const target = interaction.options.getUser("target", true);
        await allowUser(target.id, interaction.guildId);
        return interaction.reply({ content: `Allowed user <@${target.id}> to use Steve.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === "role") {
        const target = interaction.options.getRole("target", true);
        await allowRole(target.id, interaction.guildId);
        return interaction.reply({ content: `Allowed role <@&${target.id}> to use Steve.`, flags: MessageFlags.Ephemeral });
      }
    }

    if (cmd === "disallow") {
      if (sub === "user") {
        const target = interaction.options.getUser("target", true);
        await disallowUser(target.id, interaction.guildId);
        return interaction.reply({ content: `Disallowed user <@${target.id}> from using Steve.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === "role") {
        const target = interaction.options.getRole("target", true);
        await disallowRole(target.id, interaction.guildId);
        return interaction.reply({ content: `Disallowed role <@&${target.id}> from using Steve.`, flags: MessageFlags.Ephemeral });
      }
    }
  } catch (e) {
    log.error("Slash command error:", getErrorMessage(e));
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "Error processing command.", flags: MessageFlags.Ephemeral }); } catch {}
    }
  }
});
