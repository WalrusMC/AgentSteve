import { logAmount } from "../../devVariables.js";
import path from "path";
import { fileURLToPath } from 'url';
import { createLogger } from "../utils/logger.js";
import type { Message } from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createLogger("sendMsgDiscord");

const maxLength = 2000;
const separator = "\n"

/**
 * Sends one or more Discord messages, splitting long content at newline boundaries
 * to respect the 2000-character limit. Optionally attaches files from downloads.
 */
export async function sendMsgDiscord(msgToSend: string, initiatingMsg: Message, files: string[] | false = false) {
  const messageSections: string[] = [];
  const sentMessages: Message[] = [];

  const guildId = initiatingMsg.guildId;
  const filePaths =
    guildId && Array.isArray(files) && files.length
      ? files.map((element) => path.join(__dirname, "downloads", guildId, element))
      : undefined;

  // While content remains, split on the nearest newline under 2000 chars
  while (msgToSend) {
    if (msgToSend?.length > maxLength) {
      log.debug("Splitting long message for Discord limit");

      messageSections.push(
        msgToSend.substring(
          0,
          msgToSend.lastIndexOf(separator, maxLength)
        )
      )
    } else {
      // Push the final remaining section
      messageSections.push(msgToSend);
      msgToSend = "";
      break;
    }

    // Remove the portion we just sent (including the newline)
    msgToSend = msgToSend?.slice(msgToSend?.lastIndexOf(separator, maxLength) + 1);
  }

  for (const messageSection of messageSections) {
    log.debug(`Sending section (${messageSection.length} chars)`);
    sentMessages.push(await initiatingMsg.reply(messageSection));
  }

  if (filePaths) sentMessages.push(await initiatingMsg.reply({ files: filePaths }));

  return sentMessages;
}
