import { PermissionsBitField } from "discord.js";
import type { CustomMessage, PastChats } from "../types.js";
import type { GuildMember, Message, Snowflake } from "discord.js";

/**
 * Returns an array of past chat objects.
 * for model context. Newest messages appear last.
 * Labels senders as ADMINISTRATOR if they are whitelisted (aligned with prompts).
 */

export async function getPastChats(message: Message, limit: number): Promise<PastChats> {
  const guildId = message.guildId;
  if (!guildId) return [];

  const fetchLimit = Math.min(100, Math.max(1, Math.round(limit / 200)));
  const getChats = await message.channel.messages.fetch({ limit: fetchLimit });
  let chats = Array.from(getChats.values());
  chats.sort((a, b) => b.createdTimestamp - a.createdTimestamp );
  chats = chats.filter(c => c.id !== message.id);
  const chatArray: CustomMessage[] = [];
  let lengthCounter = 0;

  type Person = {
    member: GuildMember | null;
    username: string;
    id: Snowflake | "UNKNOWN ID";
    role: boolean;
  };

  for (const chat of chats) {
    lengthCounter += chat.content.length;
    if (lengthCounter < limit) {
      const attachmentNames = chat?.attachments?.size
        ? chat.attachments.map(att => att.name ?? "UNKNOWN_ATTACHMENT")
        : [];
      const person: Person = { member: null, username: "UNKNOWN USER", id: "UNKNOWN ID", role: false };
      try {
        // Ensure we can inspect roles/whitelist for this author
        person.member = await message.guild?.members.fetch(chat.author.id) ?? null;
        person.username = chat.author.username;
        person.id = chat.author.id;
        person.role = chat.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ? true : false
      } catch {
        // Fall back if the member is not resolvable (e.g., left server)
        person.member = null;
        person.username = chat.author?.username || "UNKNOWN USER";
        person.id = (chat.author?.id as Snowflake | undefined) || "UNKNOWN ID";
        person.role = false;
      }

      chatArray.unshift(
        {
          time: chat.createdAt.toISOString(),
          author: {
            id: person.id,
            username: person.username,
            isAdministrator: person.role
          },
          content: chat.content,
          attachments: attachmentNames
        }
      );
    }
  }

  return chatArray;

};
