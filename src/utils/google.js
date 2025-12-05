import { google } from "googleapis";
import fs from "fs/promises";

const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json")).web;
const CLIENT_SECRET = KEY_FILE.client_secret;
const CLIENT_ID = KEY_FILE.client_id;
const SCOPES = ["https://www.googleapis.com/auth/documents.readonly"];

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "http://localhost:3000/oauth/google/callback"
);

export const gdoc = {};

/** Extracts different document tabs out of a document and returns:
 * [
 *  {
 *    title: string,
 *    content: string,
 *    subTabs: array
 *  }
 * ]
*/
gdoc.getTabs = function(tabs) {
  const tabArray = [];
  tabs.forEach(obj => {
    let content = "";

    obj?.documentTab?.body?.content?.forEach?.(obj => {
      obj?.paragraph?.elements?.forEach?.(obj => {
        content += obj?.textRun?.content;
      });
    })

    tabArray.push({
      title: obj.tabProperties.title,
      content: content,
      subTabs: obj?.childTabs?.length ? gdoc.getTabs(obj.childTabs) : []
    })

  })
  return tabArray;
}

// Entry point for extracting documents from a message
gdoc.read = async function(message) {

  // Extract IDs
  const docIds = gdoc.extractIds(message);

  // Array to store final document objects
  const documents = [];

  // Exit function if no doc ids were found
  if (!docIds?.length) return {
    success: false,
    data: "NO_DOC_IDS"
  };

  // Get latest authorization token
  const token = JSON.parse(await fs.readFile(`./db/${message.guildId}/users.json`))?.[message.author.id]?.token;

  // If no token, get a new token
  if (!token) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state: `${message.author.id},${message.guildId}`
    });
    await message.reply(`I need permission to view that document. Click [this link](<${authUrl}>) to give me permission.`);
    return {
      success: false,
      data: "NO_AUTH"
    };
  }

  oauth2Client.setCredentials(token);

  // Create docs client
  const docs = google.docs({ version: "v1", auth: oauth2Client });

  // Get each document by the ID
  for (const id of docIds) {
    let res;
    try {
      res = await docs.documents.get({
        documentId: id,
        includeTabsContent: true
      });
    } catch {
      res = false;
    }

    if (res) {
      documents.push({
        title: res.data.title,
        id: id,
        link: `https://docs.google.com/document/d/${id}/`,
        tabs: gdoc.getTabs(res.data.tabs || [])
      });
    }
  }

  // If no documents could be retrieved, exit the function
  if (!documents?.length) return {
    success: false,
    data: "NO_ACCESS"
  };

  // Return the final document object
  return {
    success: true,
    data: documents,
    characterCount: JSON.stringify(documents).length
  };

}

// Extracts document IDs from a message if they exist
gdoc.extractIds = function(message) {
  const docIds = [];
  const ids = message.content.split("https://docs.google.com/document/d/");
  if (!ids?.length) return [];
  ids.shift();
  ids.forEach(str => {
    const spaceIndex = str.indexOf(" ") !== -1 ? str.indexOf(" ") : NaN;
    const slashIndex = str.indexOf("/") !== -1 ? str.indexOf("/") : NaN;
    if (spaceIndex || slashIndex) {
      const seperator = (spaceIndex < slashIndex) || !slashIndex ? " " : "/";
      docIds.push(str.substring(0, str.indexOf(seperator)));
    }
  })
  return docIds;
}
