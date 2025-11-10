import { isUserAllowed } from "./whitelist.js";

/**
 * Returns a compact string of recent chats in the channel (excluding the triggering message)
 * for context, newest-last, limited to ~2000 characters.
 */

export async function getPastChats(message) {
  const getChats = await message.channel.messages.fetch({ limit: 10 });
  let chats = Array.from(getChats.values());
  chats.sort((a, b) => b.createdTimestamp - a.createdTimestamp );
  chats = chats.filter(c => c.id !== message.id);
  let chatString = "";
  let lengthCounter = 0;

  for (const chat of chats) {
    lengthCounter += chat.content.length;
    if (lengthCounter < 2002) {
      let person = {};
      try {
        person.member = await message.guild.members.fetch(chat.author.id);
        person.username = chat.author.username;
        person.id = chat.author.id;
        person.role = await isUserAllowed(member, chat.guildId) ? "ADMINISTRATOR" : "NOT ADMINISTRATOR";
      } catch {
        person.member = false;
        person.username = "UNKNOWN USER";
        person.id = "UNKNOW ID";
        person.role = "NOT ADMINISTRATOR"
      }

      chatString = `UTC_TIME:${chat.createdAt.toISOString()}|ROLE:${person.role}|USERNMAME:${person.username}|USER_ID:${person.id}|CHAT:${chat.content}\n` + chatString;
    }
  }

  return chatString;

};
