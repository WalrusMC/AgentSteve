import { logAmount } from "../../devVariables.js";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const maxLength = 2000;
const separator = "\n"

export async function sendMsgDiscord(msgToSend, initiatingMsg, files = false) {
  const messageSections = []; // Array to store all message sections
  const sentMessages = []; // Array to store final message sections

  if (!files.length) files = false;
  if (files) files.forEach((element, index) => {
    files[index] = path.join(__dirname, "storedFiles", element);
  });

  // While msgToSend is still a non-empty string
  while(msgToSend) {
    // If msgToSend.length > maxLength
    // Take msgToSend[0] through msgToSend[index of the nearest character to the maxLength right before the separator]
    if (msgToSend?.length > maxLength) {
      if (logAmount === 2) console.log("LOG: Splitting message to send.");

      messageSections.push(
        msgToSend.substring(
          0,
          msgToSend.lastIndexOf(separator, maxLength)
        )
      )
    } else {
      // Add the remaining characters in msgToSend to messageSections[]
      messageSections.push(msgToSend);
      msgToSend = false;
      break;
    }

    // Remove msgToSend[0] through msgToSend[index of last character of the separator]
    msgToSend = msgToSend?.slice(msgToSend?.lastIndexOf(separator, maxLength) + 1);
  }

  for (const messageSection of messageSections) {
    if (logAmount === 2) console.log(`LOG: Sending a message with a length of ${messageSection.length} characters`);
    sentMessages.push(await initiatingMsg.channel.send(messageSection));
  }

  if (files) sentMessages.push(await initiatingMsg.channel.send({ files: files }));

  return sentMessages;
}