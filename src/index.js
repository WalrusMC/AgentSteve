import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField, MessageFlags } from "discord.js";
import { router } from "./router.js";
import { summarizer } from "./summarizer.js";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "./utils/logger.js";
import { isUserAllowed, allowUser, allowRole, disallowUser, disallowRole } from "./utils/whitelist.js";

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
      await g.commands.set(commands);
      log.info(`Registered commands in guild ${g.id}`);
      try { 
        await fs.access(`./db/${g.id}`);
      } catch {
        await fs.mkdir(`./db/${g.id}`);
        await fs.writeFile(`./db/${g.id}/files.json`, "{}");
        await fs.writeFile(`./db/${g.id}/summaries.json`, "{}");   
        await fs.writeFile(`./db/${g.id}/whitelist.json`, JSON.stringify({ users: [], roles: [] }, null, 2));
        await fs.mkdir(`./src/tools/storedFiles/${g.id}`);
        log.info(`Created database for guild ${g.id}`);
      }
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
  await guild.commands.set(commands);
  log.info(`Registered commands in guild ${guild.id}`);
  try { 
    await fs.access(`./db/${guild.id}`);
  } catch {
    await fs.mkdir(`./db/${guild.id}`);
    await fs.writeFile(`./db/${guild.id}/files.json`, "{}");
    await fs.writeFile(`./db/${guild.id}/summaries.json`, "{}");   
    await fs.writeFile(`./db/${guild.id}/whitelist.json`, JSON.stringify({ users: [], roles: [] }, null, 2));
    await fs.mkdir(`./src/tools/storedFiles/${guild.id}`);
    log.info(`Created database for guild ${guild.id}`);
  }
});

// Login
client.login(process.env.TOKEN);

let currentlyRunning = {};

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.mentions.everyone) return;
  if (!message.mentions.has(client.user)) return;
  if (currentlyRunning[`${message.guildId}`]) return message.channel.send("Slow down there! I can only answer one question at a time.");
  const allowed = await isUserAllowed(message.member, message.guildId);
  if (allowed && message.mentions.has(client.user)) {
    currentlyRunning[`${message.guildId}`] = true;

    log.debug("User pinged Steve and has correct permissions");
  
    // Make bot say typing while it generates a response
    log.debug("Started typing");
    message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      log.debug("Continuing typing indicator");
      if(currentlyRunning) message.channel.sendTyping();
    }, 9000);

    // If the user attached files, download and index them for tool access
    try {
      if (message.attachments?.size) {
        log.info(`Found ${message.attachments.size} attachment(s); downloading...`);
        const storedDir = path.join(process.cwd(), "src", "tools", "storedFiles", message.guildId);
        try { await fs.mkdir(storedDir, { recursive: true }); } catch {}

        const filesIndexPath = path.join(process.cwd(), "db", message.guildId, "files.json");
        let filesIndex = {};
        try {
          filesIndex = JSON.parse(await fs.readFile(filesIndexPath, "utf8"));
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
            filesIndex[fileName] = `User-uploaded file from @${message.author.username} (${message.author.id}) at ${new Date().toISOString()}`;
            log.info(`Saved attachment as ${fileName}`);
          } catch (err) {
            log.error("Failed to save attachment:", err?.message || err);
          }
        }
        await fs.writeFile(filesIndexPath, JSON.stringify(filesIndex, null, 2));
      }
    } catch (err) {
      log.error("Attachment handling failed:", err?.message || err);
    }

    // Summarize
    summarizer(message);

    // Respond to user request
    const summaries = JSON.parse(await fs.readFile(`./db/${message.guildId}/summaries.json`, "utf8"));
    const sentMessages = await router(message, summaries[message.channel.id] ? summaries[message.channel.id] : "NO PAST SUMMARIZATION FOUND!");

    // Remove embeds
    for (const sentMessage of sentMessages ) {
      log.debug("Suppressing embeds for sent message");
      sentMessage.suppressEmbeds(true);
    }

    // Stop typing
    log.debug("Cleared typing interval");
    clearInterval(typingInterval);

    currentlyRunning[`${message.guildId}`] = false;

  }
})

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
        return interaction.reply({ content: `Allowed role <@&${target.id}> to use Steve.`, eflags: MessageFlags.Ephemeral });
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

