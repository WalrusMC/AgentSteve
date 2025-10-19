import { logAmount, logResponse } from "../devVariables.js";
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { followInstructions } from "./instructions.js";

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

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.mentions.everyone) return;
  if (roleIds.some(role => message.member.roles.cache.has(role)) && message.mentions.has(client.user)) {
    if (logAmount === 2) console.log("LOG: A user pinged Steve and has correct permissions");
  
    // Make bot say typing while it generates a response
    if (logAmount === 2) console.log("LOG: Steve started typing");
    message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      if (logAmount === 2) console.log("LOG: Steve started typing again");
      message.channel.sendTyping();
    }, 9000);

    // Generate response
    const sentMessages = await followInstructions(message);

    // Remove embeds
    for (const sentMessage of sentMessages ) {
      if (logAmount === 2) console.log("LOG: Suppressing embeds");
      sentMessage.suppressEmbeds(true);
    }

    // Stop typing
    if (logAmount === 2) console.log("LOG: Cleared typing interval");
    clearInterval(typingInterval);

  } else if(catIds.includes(message.channel.parentId)) {
    if (logAmount === 2) console.log("LOG: User did not ping Steve or does not have permission to ping Steve and is typing in a support ticket");
    // Placeholder
    return;
  }
})