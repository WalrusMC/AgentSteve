import { isUserAllowed } from "./whitelist.js";

/**
 * Returns an array of past chat objects.
 * for model context. Newest messages appear last. Limited to ~2000 chars.
 * Labels senders as ADMINISTRATOR if they are whitelisted (aligned with prompts).
 */

export async function getPastChats(message) {
  const getChats = await message.channel.messages.fetch({ limit: 10 });
  let chats = Array.from(getChats.values());
  chats.sort((a, b) => b.createdTimestamp - a.createdTimestamp );
  chats = chats.filter(c => c.id !== message.id);
  let chatArray = [];
  let lengthCounter = 0;

  for (const chat of chats) {
    lengthCounter += chat.content.length;
    if (lengthCounter < 2002) {
      const person = {};
      try {
        // Ensure we can inspect roles/whitelist for this author
        person.member = await message.guild.members.fetch(chat.author.id);
        person.username = chat.author.username;
        person.id = chat.author.id;
        // Treat whitelisted users as ADMINISTRATOR for context labelling
        person.role = (await isUserAllowed(person.member, message.guildId)) ? true : false;
      } catch {
        // Fall back if the member is not resolvable (e.g., left server)
        person.member = null;
        person.username = chat.author?.username || "UNKNOWN USER";
        person.id = chat.author?.id || "UNKNOWN ID";
        person.role = false;
      }

      chatArray.push(
        {
          time: chat.createdAt.toISOString(),
          author: {
            id: person.id,
            username: person.username,
            isAdministrator: person.role
          },
          content: chat.content
        }
      );
    }
  }

  return chatArray;

};
