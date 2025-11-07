import { logAmount } from "../../devVariables.js";

const roleIds = process.env.EVERY_ROLE_ID.split(",");

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
      let role;

      await message.guild.members.fetch(chat.author.id);

      if (chat.member && roleIds.some(role => chat.member.roles.cache.has(role))) {
        role = "CORE TEAM";
      } else {
        role = "NOT CORE TEAM";
      }

      chatString = `UTC_TIME:${chat.createdAt.toISOString()}|ROLE:${role}|USERNMAME:${chat.author.username}|USER_ID:${chat.author.id}|CHAT:${chat.content}\n` + chatString;
    }
  }

  return chatString;

};