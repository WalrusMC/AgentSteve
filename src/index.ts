import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
import { router } from "./router.js";
import path from "path";
import { createLogger } from "./utils/logger.js";
import { moderate } from "./agents/moderate.js";
import { getPastChats } from "./utils/getPastChats.js";
import { gdoc } from "./tools/google.js";
import { prisma } from "../lib/prisma.js";
import fs from "fs/promises";
import { pterodactylWS } from "./tools/server/websocket.js";
import type { AgentInfo, ResponderResponse, ToolResult } from "./types.js";
import type { ReadDocFail, ReadDocSuccess } from "./tools/google.js";

// TEMP TESTING sorry if I forget to remove this in commit #REMOVE
import { architect } from "./agents/plugins/architect.js";
import { arch } from "os";

// Logger scoped to the Discord bot entrypoint
const log = createLogger("index");
const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Ensure the the downloads folder path exists for the corresponding guild
const ensureDownloadPath = async function(guildId: string) {
  try {
    await fs.access(`./src/tools/downloads/${guildId}/`);
  } catch {
    await fs.mkdir(`./src/tools/downloads/${guildId}/`);
  }
}

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

// TO DO: create commands

/**
 * On Bot Startup
 * Register Commands TO DO: create commands
 * Ensure Databases Are Created
 */
client.once("clientReady", async (readyClient) => {
  log.info(`Ready! Logged in as ${readyClient.user.tag}`);
  try {
    for (const g of readyClient.guilds.cache.values()) {
      await ensureDownloadPath(g.id);
      await prisma.guild.upsert({
        where: {
          id: g.id,
        },
        update: {},
        create: {
          id: g.id,
          name: g.name,
        },
      });
    }
  } catch (e: unknown) {
    log.error("Failed to register commands or create databases on ready:", getErrorMessage(e));
  }
});

/**
 * On Guild Join
 * Register commands TO DO: create commands
 * Create databases
 */
client.on("guildCreate", async guild => {
  await ensureDownloadPath(guild.id);
  await prisma.guild.upsert({
    where: {
      id: guild.id,
    },
    update: {},
    create: {
      id: guild.id,
      name: guild.name,
    },
  });

  log.info(`Registered commands and created databases for guild ${guild.id}`);
});

// Login
client.login(process.env.DISCORD_TOKEN);

const clarifications: Record<string, string> = {};
const currentlyRunning: Record<string, boolean> = {};

client.on("messageCreate", async (message) => {
  // Exit if the author is a bot, pinged everyone, or didn't mention Steve
  if (message.author.bot || message.mentions.everyone || !message.guildId) return;
  if (!client.user || !message.mentions.has(client.user)) return;
  if (!message.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) return await message.reply(":warning: You don't have permission to talk to me right now. Only server administrators can talk to me.");
  if (currentlyRunning[`${message.guildId}`]) return await message.reply("Slow down there! I can only answer one question at a time.");

  
  const servers = await prisma.server.findMany({
    where: {
      guildId: message.guildId
    }
  });

  if (servers.length) pterodactylWS.connect(servers.map(obj => obj.id));

  const info: AgentInfo = {
    guildId: message.guildId,
    message,
    pastChats: await getPastChats(message, 2100)
  }
  const toolHistory: ToolResult<any, any>[] = [];
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
            await prisma.download.create({
              data: {
                file: fileName,
                description: `User-uploaded file from @${message.author.username} (${message.author.id}) at ${new Date().toISOString()}`,
                guildId: message.guildId
              }
            });
            log.info(`Saved attachment as ${fileName}`);
          } catch (err: unknown) {
            log.error("Failed to save attachment:", getErrorMessage(err));
          }
        }
      }
    } catch (err: unknown) {
      log.error("Attachment handling failed:", getErrorMessage(err));
    }


    
    
    // Documents
    const readDocResult: ToolResult<ReadDocSuccess, ReadDocFail> = message.content.includes("https://docs.google.com/document/d/") ? await gdoc.read(message.guildId, message.content, message) : { name: "readDoc", success: false, error: { reason: "NO_DOCS", code: 204 } };
    if (!readDocResult.success) {
      switch (readDocResult.error.reason) {
        case "FORBIDDEN":
        case "NO_AUTH":
          return; // Message is sent to user on how they can authorize Steve to access Doc.
      }
    }
    if (readDocResult.success) {
      if (readDocResult.result.size > 20000) {
        // TO DO: Document summarizer (Feed sections of document to GPT nano)
        if (readDocResult.result.documents.length > 1) return await message.reply("Those documents are too big for me to read! Try sending me a single, smaller document.");
        return await message.reply("That document is too big for me to read! Try sending me a smaller one. (< 15,000 characters)");
      } else if (readDocResult.result.size > 5000) {
        // TO DO: Rate limit big documents
      }
    }
    if (!readDocResult.success && readDocResult?.error?.code !== 204 && readDocResult?.error?.code !== 404) toolHistory.push({ ...readDocResult, name: "readDoc" });
    if (readDocResult.success) toolHistory.push({ ...readDocResult, name: "readDoc" });

    // Memory - TO DO: Create memory summaries and just memory lol

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
