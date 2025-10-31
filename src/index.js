import { logAmount } from "../devVariables.js";
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { router } from "./router.js";
import { summarizer } from "./summarizer.js";
import fs from "fs";

const roleIds = process.env.EVERY_ROLE_ID.split(",");
const catIds = process.env.EVERY_CAT_ID.split(",");

// Create client
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

// On client ready
client.once("clientReady", (readyClient) => {
  console.log(`LOG: Ready! Logged in as ${readyClient.user.tag}`);
});

// Login
client.login(process.env.TOKEN);

let currentlyRunning = false;

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.mentions.everyone) return;
  if (roleIds.some(role => message.member.roles.cache.has(role)) && message.mentions.has(client.user) && !currentlyRunning) {
    currentlyRunning = true;
    if (logAmount === 2) console.log("LOG: A user pinged Steve and has correct permissions");
  
    // Make bot say typing while it generates a response
    if (logAmount === 2) console.log("LOG: Steve started typing");
    message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      if (logAmount === 2) console.log("LOG: Steve started typing again");
      message.channel.sendTyping();
    }, 9000);

    // Summarize
    summarizer(message);

    // Respond to user request
    const summaries = JSON.parse(fs.readFileSync("./db/summaries.json", "utf8"));
    const sentMessages = await router(message, summaries[message.channel.id] ? summaries[message.channel.id] : "NO PAST SUMMARIZATION FOUND!");

    // Remove embeds
    for (const sentMessage of sentMessages ) {
      if (logAmount === 2) console.log("LOG: Suppressing embeds");
      sentMessage.suppressEmbeds(true);
    }

    // Stop typing
    if (logAmount === 2) console.log("LOG: Cleared typing interval");
    clearInterval(typingInterval);

    currentlyRunning = false;

  } else if(catIds.includes(message.channel.parentId)) {
    //if (logAmount === 2) console.log("LOG: User did not ping Steve or does not have permission to ping Steve and is typing in a support ticket");
    // Placeholder
    return;
  }
})