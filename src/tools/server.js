import "dotenv/config";
import fs from "fs/promises";
import axios from "axios";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Server Tool");

const PANEL_URL = "https://panel.wepwawet.net";
const API_KEY = process.env.WEPWAWET_TOKEN;

const api = axios.create({
  baseURL: `${PANEL_URL}/api/client`,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

export const server = {};

const readServers = async (guildId) => {
  try {
    return JSON.parse(await fs.readFile(`./db/${guildId}/servers.json`, "utf8"));
  } catch {
    return {};
  }
};

server.addNew = async function (guildId, serverId) {
  const servers = await readServers(guildId);
  const serverIds = Object.keys(servers);

  if (serverIds.includes(serverId)) {
    return "ALREADY_ACCESSIBLE";
  }

  let serverDetails;
  try {
    serverDetails = await api.get(`/servers/${serverId}`);
  } catch (err) {
    const status = err?.response?.status;
    switch (status) {
      case 403:
        return "NO_ACCESS";
      case 404:
        return "NO_SERVER";
      case 401:
        log.error(err);
        return "INVALID_KEY";
      case 500:
        log.error("DAMN IT, IT'S THE INITIAL SERVER REQUEST");
        return "500";
      default:
        log.error(err);
        return "UNKNOWN";
    }
  }

  const serverName = serverDetails?.data?.attributes?.name || serverId;

  let accessText;
  try {
    accessText = await api.get(`/servers/${serverId}/files/contents`, {
      params: { file: "/agentsteve.txt" },
    });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) return "NO_FILE";
    if (status === 403) return "NO_ACCESS";
    if (status === 500) return "500";
    log.error(err);
    if (status === 401) return "INVALID_KEY";
    return "UNKNOWN";
  }

  if ((toString(accessText.data) || "").trim() === toString(guildId)) {
    servers[serverId] = serverName;
    await fs.writeFile(`./db/${guildId}/servers.json`, JSON.stringify(servers, null, 2));
    const data = await server.deleteFile(guildId, serverId, "agentsteve.txt");
    if (data.success || data.code === 403) {
      return "ACCESS_GRANTED";
    }
    log.error(JSON.stringify(data, null, 2));
    return "INTERNAL_SERVER_ERROR";
  }

  return "INCORRECT_FILE";
};

server.check = async function (guildId, serverId) {
  const serverIds = Object.keys(await readServers(guildId));
  return serverIds.includes(serverId);
};

server.deleteFile = async function (guildId, serverId, file) {
  if (!(await server.check(guildId, serverId))) {
    return { success: false, data: "The target server does not exist or you do not have access to it.", code: false };
  }

  try {
    await api.post(`/servers/${serverId}/files/delete`, {
      root: "/",
      files: [file],
    });
  } catch (err) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, data: "The target file does not exist.", code: 404 };
      case 403:
        return { success: false, data: "You do not have permission: file.delete.", code: 403 };
      case 500:
        return { success: false, data: "The target file does not exist or an internal error occured."}
      default:
        return { success: false, data: "An unknown error has occured.", code: 500 };
    }
  }

  return { success: true, data: "The target file was successfully deleted.", code: 204 };
};
