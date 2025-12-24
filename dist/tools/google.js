import { google } from "googleapis";
import fs from "fs/promises";
const KEY_FILE = JSON.parse(await fs.readFile("./google-key-file.json", "utf8")).web;
const CLIENT_SECRET = KEY_FILE.client_secret;
const CLIENT_ID = KEY_FILE.client_id;
const SCOPES = ["https://www.googleapis.com/auth/documents.readonly"];
// Web server proxies the callback at /aiagents/steve/oauth/google/callback
const createOAuthClient = () => new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "http://localhost:3000/aiagents/steve/oauth/google/callback");
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
gdoc.getTabs = function (tabs) {
    const tabArray = [];
    (tabs || []).forEach((obj) => {
        let content = "";
        obj?.documentTab?.body?.content?.forEach?.((contentObj) => {
            contentObj?.paragraph?.elements?.forEach?.((elementObj) => {
                content += elementObj?.textRun?.content;
            });
        });
        tabArray.push({
            title: obj?.tabProperties?.title ?? "Untitled",
            content: content,
            subTabs: obj?.childTabs?.length ? gdoc.getTabs(obj.childTabs) : []
        });
    });
    return tabArray;
};
// Entry point for extracting documents from a message
gdoc.read = async function (content, message, ids) {
    // Extract IDs or use given IDs
    const docIds = content ? gdoc.extractIds(content) : ids;
    // Array to store final document objects
    const documents = [];
    // Exit function if no doc ids were found
    if (!docIds?.length)
        return {
            name: "gdoc.read",
            success: false,
            result: "NO_DOCS",
            code: 204
        };
    // Get latest authorization token
    const userRecord = JSON.parse(await fs.readFile(`./db/${message.guildId}/users.json`, "utf8"))?.[message.author.id];
    let tokens = userRecord?.tokens || userRecord?.token;
    if (typeof tokens === "string") {
        try {
            tokens = JSON.parse(tokens);
        }
        catch {
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
            result: "NO_AUTH",
            code: 401
        };
    }
    oauth2Client.setCredentials(tokens);
    // Create docs client
    const docs = google.docs({ version: "v1", auth: oauth2Client });
    // Get each document by the ID
    const errors = [];
    for (const id of docIds) {
        let res;
        try {
            res = await docs.documents.get({
                documentId: id,
                includeTabsContent: true
            });
        }
        catch (err) {
            const status = err?.response?.status;
            const data = err?.response?.data;
            const messageText = err?.message ? String(err.message) : undefined;
            errors.push({ id, status, message: messageText, data });
            // Token refresh failures commonly surface as 400 invalid_grant
            const invalidGrant = status === 400 &&
                (data?.error === "invalid_grant" ||
                    data?.error?.status === "INVALID_ARGUMENT" && String(data?.error?.message || "").includes("invalid_grant") ||
                    (messageText && messageText.includes("invalid_grant")));
            if (invalidGrant || status === 401 || status === 403) {
                await message.reply(`I need permission to view this document: <https://docs.google.com/document/d/${id}/>. Click [this link](<${authUrl}>) to give me permission.`);
                return {
                    name: "gdoc.read",
                    success: false,
                    result: invalidGrant ? "NO_AUTH" : "FORBIDDEN",
                    code: invalidGrant ? 401 : (status === 401 ? 401 : 403),
                    metaData: { id, status, data }
                };
            }
            else if (status === 404) {
                res = false;
            }
            else {
                res = false;
            }
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
    if (!documents?.length)
        return {
            name: "gdoc.read",
            success: false,
            result: (() => {
                const hasUnknown = errors.some(e => e.status == null);
                const hasNon404 = errors.some(e => e.status && e.status !== 404 && e.status !== 401 && e.status !== 403);
                return hasUnknown || hasNon404 ? "ERROR" : "NOT_FOUND";
            })(),
            code: (() => {
                const firstNon404 = errors.find(e => e.status && e.status !== 404 && e.status !== 401 && e.status !== 403);
                const hasUnknown = errors.some(e => e.status == null);
                return firstNon404?.status ?? (hasUnknown ? 500 : 404);
            })(),
            metaData: { errors }
        };
    // Return the final document object
    return {
        name: "gdoc.read",
        success: true,
        result: documents,
        code: 200,
        metaData: { size: JSON.stringify(documents).length }
    };
};
// Extracts document IDs from a message if they exist
gdoc.extractIds = function (content) {
    const docIds = [];
    const ids = content.split("https://docs.google.com/document/d/");
    if (!ids?.length)
        return [];
    ids.shift();
    ids.forEach((str) => {
        const spaceIndex = str.indexOf(" ") !== -1 ? str.indexOf(" ") : NaN;
        const slashIndex = str.indexOf("/") !== -1 ? str.indexOf("/") : NaN;
        if (spaceIndex || slashIndex) {
            const seperator = (spaceIndex < slashIndex) || !slashIndex ? " " : "/";
            docIds.push(str.substring(0, str.indexOf(seperator)));
        }
    });
    const uniqueDocIds = [...new Set(docIds)];
    return uniqueDocIds;
};
