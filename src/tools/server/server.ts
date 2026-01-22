import "dotenv/config";
import axios from "axios";
import { createLogger } from "../../utils/logger.js";
import { prisma } from "../../../lib/prisma.js";
import { pterodactylWS } from "./websocket.js";
import { file, ServerFiles } from "./files.js";
import type { ToolResult } from "../../types.js";

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

export type ServerData = {
  id: string,
  name: string,
  description: string,
  type: string,
  version: string,
  status: string,
  specs: {
    memory: string,
    disk: string,
    cpu: string
  },
  ip: string,
  ports: {
    port: number,
    notes: string,
    is_primary: boolean
  }[]
};

export type AddNewServerResult =
  | "NO_ACCESS"
  | "NO_SERVER"
  | "INVALID_KEY"
  | "500"
  | "UNKNOWN"
  | "ALREADY_ACCESSIBLE"
  | "NO_FILE"
  | "ACCESS_GRANTED"
  | "INTERNAL_SERVER_ERROR"
  | "INCORRECT_FILE";

export interface ServerTool {
  addNew(guildId: string, serverId: string): Promise<AddNewServerResult>;
  check(guildId: string, serverId: string): Promise<boolean>;
  readAndUpdate(
    guildId: string,
  ): Promise<Array<{ data: ServerData; status: string; id: string }>>;
  power(serverId: string, signal: "start" | "stop" | "restart" | "kill"): Promise<ToolResult<string, { reason: string, code: number }>>
  file: ServerFiles
}

export const server = { file } as ServerTool;

// Read accessible servers from ./db/${guildId}/servers.json
const readServers = async (guildId: string) => {
  return await prisma.server.findMany({
    where: {
      guildId
    }
  })
};

// Checks if Steve has access to a server. If Steve does not have access, tries to grant Steve access. 
server.addNew = async function (guildId: string, serverId: string) {
  const servers = await readServers(guildId);
  const serverIds = servers.map(obj => obj.id);

  let serverDetails: any;
  try {
    serverDetails = await api.get(`/servers/${serverId}/`);
  } catch (err: any) {
    const status = err?.response?.status;
    if (serverIds.includes(serverId)) {
      await prisma.server.delete({
        where: {
          guildId,
          id: serverId
        }
      })
    }
    switch (status) {
      case 403:
        return "NO_ACCESS";
      case 404:
        return "NO_SERVER";
      case 401:
        log.error(err);
        return "INVALID_KEY";
      case 500:
        log.error(`Wepwawet rejected the request (/servers/${serverId}/) with status code 500.`);
        return "500";
      default:
        log.error(err);
        return "UNKNOWN";
    }
  }

  if (serverIds.includes(serverId)) {
    return "ALREADY_ACCESSIBLE";
  }

  const serverName = serverDetails?.data?.attributes?.name || serverId;

  let accessText;
  try {
    accessText = await api.get(`/servers/${serverId}/files/contents`, {
      params: { file: "/agentsteve.txt" },
      // Ensure we treat the response as plain text. If the file contains only digits,
      // Axios/JSON parsing can coerce it into a Number and lose precision (Discord snowflakes > 2^53).
      responseType: "text",
    });
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) return "NO_FILE";
    if (status === 403) return "NO_ACCESS";
    if (status === 500) return "500";
    log.error(`An error occurred while trying to GET the file contents from the remote Pterodactyl server (${serverId}). Here is the error: ${err}`);
    if (status === 401) return "INVALID_KEY";
    log.error(`An unkown error has occurred while trying to read a file for guild ${guildId} on server ${serverId}`);
    return "UNKNOWN";
  }

  // Write information to db/guildId/servers.json
  log.debug(`This is the key recieved: ${String(accessText.data)}. This is the target guild: ${guildId}`);
  if (!String(accessText.data)) {
    log.error(`There was an error reading the agentsteve.txt file or it was blank for guild ${guildId} on server ${serverId}.`);
    return "INCORRECT_FILE";
  }

  // Check if file code is correct
  if (!((String(accessText.data)).trim() === String(guildId))) return "INCORRECT_FILE";

  // Status and isOnline
  const status = (await prisma.server.findFirst({
    where: {
      id: serverId
    },
    select: {
      status: true
    }
  }))?.status;
  const isOnline = status === "running"

  // Get server version info
  let type = "UNKNOWN";
  let version = "UNKNOWN";
  if (isOnline) {
    const versionCommandResult = await pterodactylWS.sendCommand(serverId, "version");
    if (versionCommandResult.success) {
      if (versionCommandResult.result.includes("This server is running")) {
        const getType = versionCommandResult.result.match(new RegExp(`running (.*?) version`, 's'));
        if (getType && getType[1]) type = getType[1];
        const getVersion = versionCommandResult.result.match(new RegExp(`version (.*?)-`, 's'));
        if (getVersion && getVersion[1]) version = getVersion[1];
      } else {
        type = "UNKNOWN";
        version = "UNKNOWN";
      }
    } else {
      type = "UNKNOWN";
      version = "UNKNOWN";
    }
  }

  // Add server to servers from servers.json
  await prisma.server.create({
    data: {
      data: {
        id: serverId,
        name: serverName,
        description: serverDetails.data.attributes.description,
        type: isOnline ? type : "Type unknown: server is not running",
        version: isOnline ? version : "Version unknown: server not running",
        status,
        specs: {
          memory: serverDetails.data.attributes.limits.memory,
          disk: serverDetails.data.attributes.limits.disk,
          cpu: serverDetails.data.attributes.limits.cpu
        },
        ip: serverDetails.data.attributes.relationships.allocations.data[0].ip,
        ports: serverDetails.data.attributes.relationships.allocations.data.map((data: any) => ({
          port: data.attributes.port,
          notes: data.attributes.notes,
          is_primary: data.attributes.is_default
        })),
      },
      guildId,
      id: serverId,
      type
    }
  });

  // Delete access file from remote server
  const data = await server.file.deleteMany(guildId, serverId, "agentsteve.txt");

  if (data.success || (!data.success && data.error.code === 403)) {
    return "ACCESS_GRANTED";
  }

  log.error(`The agentsteve.txt file could not be deleted. ${JSON.stringify(data, null, 2)}`);
  return "INTERNAL_SERVER_ERROR";
};

// Checks if a serverId matches an accessible server
server.check = async function (guildId: string, serverId: string) {
  const serverIds = (await readServers(guildId)).map(obj => obj.id);
  return serverIds.includes(serverId);
};

// Updates and returns information about all servers belonging to a specific guild
server.readAndUpdate = async function (guildId: string) {
  const servers = await prisma.server.findMany({
    where: {
      guildId
    }
  })

  const serversArray = [];

  for (const id of servers.map(obj => obj.id)) {


    let serverDetails: any;
    try {
      serverDetails = await api.get(`/servers/${id}/`);
    } catch (err) {
      await prisma.server.delete({
        where: {
          guildId,
          id
        }
      })
      continue;
    }

    // Get last known information
    const lastServer = (await prisma.server.findFirst({
      where: {
        id
      },
      select: {
        data: true,
        status: true
      }
    })) as { status: string, data: ServerData };

    const lastServerData = lastServer?.data;
    const status = lastServer?.status;
    const isOnline = status === "running";

    let type = lastServerData.type;
    let version = lastServerData.version;
    if (isOnline) {
      const versionCommandResult = await pterodactylWS.sendCommand(id, "version");
      if (versionCommandResult.success) {
        if (versionCommandResult.result.includes("This server is running")) {
          const getType = versionCommandResult.result.match(new RegExp(`running (.*?) version`, 's'));
          if (getType && getType[1]) type = getType[1];
          const getVersion = versionCommandResult.result.match(new RegExp(`version (.*?)-`, 's'));
          if (getVersion && getVersion[1]) version = getVersion[1];
        } else {
          type = "UNKNOWN";
          version = "UNKNOWN";
        }
      } else {
        type = "UNKNOWN";
        version = "UNKNOWN";
      }
    }

    // Create new info JSON object
    const updatedServerData: ServerData = {
      id,
      name: serverDetails?.data?.attributes?.name,
      description: serverDetails.data.attributes.description,
      type,
      version,
      status,
      specs: {
        memory: serverDetails.data.attributes.limits.memory,
        disk: serverDetails.data.attributes.limits.disk,
        cpu: serverDetails.data.attributes.limits.cpu
      },
      ip: serverDetails.data.attributes.relationships.allocations.data[0].ip,
      ports: serverDetails.data.attributes.relationships.allocations.data.map((data: any) => ({
        port: data.attributes.port,
        notes: data.attributes.notes,
        is_primary: data.attributes.is_default
      })),
    }

    // Update server
    await prisma.server.update({
      where: {
        guildId,
        id
      },
      data: {
        data: updatedServerData,
      }
    });
    serversArray.push({
      id,
      data: updatedServerData,
      status
    });
  };

  return serversArray;
}

server.power = async function (serverId, signal) {
  const name = "server.power";
  try {
    await api.post(`/servers/${serverId}/power`, {
      signal: signal
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 400:
        return { name, success: false, error: { reason: err?.response?.detail, code: 400 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have permission to do this on the remote server.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: "An internal error occured. Do not call this tool again.", code: 500 } };
      default:
        return { name, success: false, error: { reason: "An unknown error has occured. Do not call this tool again.", code: 500 } };
    }
  }

  let result = signal === "kill" ? `The server was forcably stopped (${signal})` : `The server is ${signal}ing`; // Kill, restarting, and starting
  if (signal === "stop") result = "The server is stopping"; // Stopping
  return { name, success: true, result };
}