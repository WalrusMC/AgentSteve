import { google } from "googleapis";
import fs from "fs/promises";
import { prisma } from "../../lib/prisma.js";
import type { Message } from "discord.js";
import type { ToolResult, ReadDocFail, ReadDocSuccess, DocTabs } from "../types.js";
import type { Credentials } from "google-auth-library";


// Types & Interfaces
interface Gdoc {
  read(
      guildId: string,
      content: string | false,
      message: Message, 
      ids?: string[]
    ): Promise<ToolResult<ReadDocSuccess, ReadDocFail>>;
    extractIds(content: string): string[];
}

const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json", "utf8")).web;
const CLIENT_SECRET = KEY_FILE.client_secret;
const CLIENT_ID = KEY_FILE.client_id;
const SCOPES = ["https://www.googleapis.com/auth/documents.readonly"];

// Web server proxies the callback at /aiagents/steve/oauth/google/callback
const createOAuthClient = () =>
  new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    "http://localhost:3000/aiagents/steve/oauth/google/callback"
  );

export const gdoc: Gdoc = {} as Gdoc;

/** Extracts different document tabs out of a document and returns:
 * [
 *  {
 *    title: string,
 *    content: string,
 *    subTabs: array
 *  }
 * ]
*/
const getTabs = function(tabs: any[]) {
  const tabArray: DocTabs = [];
  (tabs || []).forEach((obj: any) => {
    let content = "";

    obj?.documentTab?.body?.content?.forEach?.((contentObj: any) => {
      contentObj?.paragraph?.elements?.forEach?.((elementObj: any) => {
        content += elementObj?.textRun?.content;
      });
    })

    tabArray.push({
      title: obj?.tabProperties?.title ?? "Untitled",
      content: content,
      subTabs: obj?.childTabs?.length ? getTabs(obj.childTabs) : []
    })

  })
  return tabArray;
}

// TO DO: Fix tool results for document reading capabilities!!!!
// Entry point for extracting documents from a message
gdoc.read = async function(guildId, content, message, ids) {

  // Extract IDs or use given IDs
  const docIds = content ? gdoc.extractIds(content) : ids;

  // Array to store final document objects
  const documents = [];

  // Exit function if no doc ids were found
  if (!docIds?.length) return {
    name: "gdoc.read",
    success: false,
    error: {
      reason: "NO_DOCS",
      code: 204
    }
  };

  // Get latest authorization token
  const user = await prisma.guildUser.findFirst({
    where: {
      userId: message.author.id,
      guildId
    }
  });
  let tokensJson = user?.token
  let tokens: Credentials | false = false;
  if (typeof tokensJson === "string") {
    try {
      tokens = JSON.parse(tokensJson);
    } catch {
      // Leave as string; google auth will throw a clearer error we can handle below.
    }
  }

  // Create a fresh OAuth client per call to avoid cross-request credential races
  const oauth2Client = createOAuthClient();

  // Create authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: `${message.author.id},${message.guildId}`
  });

  // If no token, get a new token
  if (!tokens) {
    await message.reply(`I need permission to view that document. Click [this link](<${authUrl}>) to give me permission.`);
    return {
      name: "gdoc.read",
      success: false,
      error: {
        reason: "NO_AUTH",
        code: 401
      }
    };
  }

  oauth2Client.setCredentials(tokens);

  // Create docs client
  const docs = google.docs({ version: "v1", auth: oauth2Client });

  // Get each document by the ID
  const errors: Array<{ id: string; status?: number; message?: string; data?: unknown }> = [];
  for (const id of docIds) {
    let res: any;
    try {
      res = await docs.documents.get({
        documentId: id,
        includeTabsContent: true
      });
    } catch (err) {
      const status = (err as any)?.response?.status as number | undefined;
      const data = (err as any)?.response?.data;
      const messageText = (err as any)?.message ? String((err as any).message) : undefined;

      errors.push({ id, status, message: messageText, data });

      // Token refresh failures commonly surface as 400 invalid_grant
      const invalidGrant =
        status === 400 &&
        (data?.error === "invalid_grant" ||
          data?.error?.status === "INVALID_ARGUMENT" && String(data?.error?.message || "").includes("invalid_grant") ||
          (messageText && messageText.includes("invalid_grant")));

      if (invalidGrant || status === 401 || status === 403) {
        await message.reply(`I need permission to view this document: <https://docs.google.com/document/d/${id}/>. Click [this link](<${authUrl}>) to give me permission.`);
        return {
          name: "gdoc.read",
          success: false,
          error: {
            reason: invalidGrant ? "NO_AUTH" : "FORBIDDEN",
            code: invalidGrant ? 401 : (status === 401 ? 401 : 403)
          },
        };
      } else if (status === 404) {
        res = false;
      } else {
        res = false;
      }
    }

    if (res) {
      documents.push({
        title: res.data.title,
        id: id,
        link: `https://docs.google.com/document/d/${id}/`,
        tabs: getTabs(res.data.tabs || [])
      });
    }
  }

  // If no documents could be retrieved, exit the function
  if (!documents?.length) return {
    name: "gdoc.read",
    success: false,
    error: {
      reason: (() => {
      const hasUnknown = errors.some(e => e.status == null);
      const hasNon404 = errors.some(e => e.status && e.status !== 404 && e.status !== 401 && e.status !== 403);
      return hasUnknown || hasNon404 ? "UNKNOWN" : "NOT_FOUND";
    })(),
    code: (() => {
      const firstNon404 = errors.find(e => e.status && e.status !== 404 && e.status !== 401 && e.status !== 403);
      const hasUnknown = errors.some(e => e.status == null);
      return firstNon404?.status ?? (hasUnknown ? 500 : 404);
    })(),
    }
  };

  // Return the final document object
  return {
    name: "gdoc.read",
    success: true,
    result: {
      size: JSON.stringify(documents).length,
      documents: documents
    }
  };

}

// Extracts document IDs from a message if they exist
gdoc.extractIds = function(content) {
  const docIds: string[] = [];
  const ids = content.split("https://docs.google.com/document/d/");
  if (!ids?.length) return [];
  ids.shift();
  ids.forEach((str: string) => {
    const spaceIndex = str.indexOf(" ") !== -1 ? str.indexOf(" ") : NaN;
    const slashIndex = str.indexOf("/") !== -1 ? str.indexOf("/") : NaN;
    if (spaceIndex || slashIndex) {
      const seperator = (spaceIndex < slashIndex) || !slashIndex ? " " : "/";
      docIds.push(str.substring(0, str.indexOf(seperator)));
    }
  })
  const uniqueDocIds = [...new Set(docIds)];
  return uniqueDocIds;
}
