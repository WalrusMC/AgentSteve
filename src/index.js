import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField, MessageFlags } from "discord.js";
import { router } from "./router.js";
import { summarizer } from "./models/summarizer.js";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "./utils/logger.js";
import { isUserAllowed, allowUser, allowRole, disallowUser, disallowRole } from "./utils/whitelist.js";
import { ensureDBs } from "./utils/ensureDBs.js";
import { moderate } from "./models/moderate.js";
import { getPastChats } from "./utils/getPastChats.js";
import { gdoc } from "./tools/google.js";

// Logger scoped to the Discord bot entrypoint
const log = createLogger("index");

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
  } catch (e) {
    log.error("Failed to register commands or create databases on ready:", e?.message || e);
  }
});

/**
 * On Guild Join
 * Register commands
 * Create databases
 */
client.on("guildCreate", async guild => {
  await ensureDBs(guild.id);
  await guild.commands.set(commands);
  log.info(`Registered commands in guild ${guild.id}`);
});

// Login
client.login(process.env.DISCORD_TOKEN);

const clarifications = {};
const currentlyRunning = {};

client.on("messageCreate", async (message) => {
  // Exit function if:
  // - The author is a bot
  // - The author is pinging @everyone
  // - The author is NOT pinging Steve
  // - The author is NOT authorized
  if (message.author.bot) return;
  if (message.mentions.everyone) return;
  if (!message.mentions.has(client.user)) return;
  const allowed = await isUserAllowed(message.member, message.guildId);
  if (!allowed && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return await message.reply({ content: ":warning: You don't have permission to talk to me right now. Server administrators can give users permission by doing /allow {user}.", ephemeral: true });
  if (currentlyRunning[`${message.guildId}`]) return await message.reply("Slow down there! I can only answer one question at a time.");

  currentlyRunning[`${message.guildId}`] = true;

  const info = { message };

  log.debug("User pinged Steve and has correct permissions");

  // Make bot say typing while it generates a response
  log.debug("Started typing");
  message.channel.sendTyping();
  const typingInterval = setInterval(() => {
    log.debug("Continuing typing indicator");
    if (currentlyRunning[message.guildId]) {
      message.channel.sendTyping();
    } else {
      clearInterval(typingInterval);
    }
  }, 9000);

  // If the user attached files, download and index them for tool access
  try {
    if (message.attachments?.size) {
      log.info(`Found ${message.attachments.size} attachment(s); downloading...`);
      const storedDir = path.join(process.cwd(), "src", "tools", "downloads", message.guildId);
      try { await fs.mkdir(storedDir, { recursive: true }); } catch {}

      const downloadsIndexPath = path.join(process.cwd(), "db", message.guildId, "downloads.json");
      let downloadsIndex = {};
      try {
        downloadsIndex = JSON.parse(await fs.readFile(downloadsIndexPath, "utf8"));
      } catch {}

      const getUniqueName = async (dir, baseName) => {
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
        } catch (err) {
          log.error("Failed to save attachment:", err?.message || err);
        }
      }
      await fs.writeFile(downloadsIndexPath, JSON.stringify(downloadsIndex, null, 2));
    }
  } catch (err) {
    log.error("Attachment handling failed:", err?.message || err);
  }

  // Summarize
  //summarizer(message); // UNDER DEVELOPMENT

  // Past chats
  info.pastChats = await getPastChats(message, 2000);

  // Documents
  const documents = message.content.includes("https://docs.google.com/document/d/") ? await gdoc.read(message.content, message) : { success: false, data: "NO_DOCS" };
  switch (documents.data) {
    case "FORBIDDEN":
    case "NO_AUTH":
      currentlyRunning[message.guildId] = false;
      clearInterval(typingInterval);
      return;
    case "NOT_FOUND":
      documents.data = "Document not found due to broken or fake link.";
      break;
    case "NO_DOCS":
      documents.data = "No documents.";
  }
  if (documents.success) {
    if (documents.size > 20000) {
      // TO DO: Document summarizer (Feed sections of document to GPT nano)
      if (documents.data.length > 1) return await message.reply("Those documents are too big for me to read! Try sending me a single, smaller document.");
      await message.reply("That document is too big for me to read! Try sending me a smaller one. (< 15,000 characters)");
    } else if (documents.size > 5000) {
      // TO DO: Rate limit big documents
    }
  } 
  info.documents = documents.data;

  // Summaries
  const summaries = JSON.parse(await fs.readFile(`./db/${message.guildId}/summaries.json`, "utf8"));
  info.summary = summaries?.[message.channel.id] ? summaries[message.channel.id] : "NO PAST SUMMARIZATION FOUND!";

  // Forward to router, or skip the router if the last message was a clarification message.
  let sentMessages;
  switch (clarifications?.[message.guildId]) {
    case "moderate":
      sentMessages = await moderate(info);
      break;
    case "complex":
      // TO DO: Create complex responder (workflow orchestrator, etc)
      sentMessages = await message.reply("Placeholder");
      break;
    default:
      sentMessages = await router(info);
      break;
  }

  // Check if message was a clarification message and remove embeds
  if (sentMessages?.clarify) {
    clarifications[message.guildId] = sentMessages.type;
  } else if (sentMessages) {
    for (const sentMessage of sentMessages) {
      log.debug("Suppressing embeds for sent message");
      sentMessage.suppressEmbeds(true);
    }
  }

  // Stop typing
  log.debug("Cleared typing interval");
  clearInterval(typingInterval);

  currentlyRunning[`${message.guildId}`] = false;

});

// Slash command handler for allow/disallow
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
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
    log.error("Slash command error:", e?.message || e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "Error processing command.", flags: MessageFlags.Ephemeral }); } catch {}
    }
  }
});
