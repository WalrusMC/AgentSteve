import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
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

    // Make bot say typing while it generates a response
    message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      message.channel.sendTyping();
    }, 9000);

    // Generate response
    const sentMessage = await followInstructions(message);
    // Remove embeds
    await sentMessage.suppressEmbeds(true);

    // Stop typing
    clearInterval(typingInterval);

  } else if(catIds.includes(message.channel.parentId)) {
    // Placeholder
    return;
  }
})