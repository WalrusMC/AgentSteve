import "dotenv/config";
import axios from "axios";
import { createLogger } from "../../utils/logger.js";
import { prisma } from "../../../lib/prisma.js";
import { pterodactylWS } from "./websocket.js";
import { version } from "node:os";

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

export type ServerToolResponse<T> =
  | { success: true; result: T; code: number }
  | { success: false; result: string; code: number };

export type ReadFilesResult =
  | { success: false; result: string; code: number }
  | {
      success: boolean;
      result: Array<{ success: boolean; path: string; contents: unknown; code: number }>;
    };

export interface ServerTool {
  addNew(guildId: string, serverId: string): Promise<AddNewServerResult>;
  check(guildId: string, serverId: string): Promise<boolean>;
  readAndUpdate(
    guildId: string,
  ): Promise<Array<{ information: string; version: string; type: string; isOnline: boolean }>>;
  deleteFiles(
    guildId: string,
    serverId: string,
    files: string[] | string,
  ): Promise<ServerToolResponse<string>>;
  readFiles(
    guildId: string,
    serverId: string,
    files: string[] | string,
  ): Promise<ReadFilesResult>;
  readFile(serverId: string, file: string): Promise<ServerToolResponse<unknown>>;
  writeFile(
    guildId: string,
    serverId: string,
    file: string,
    content: unknown,
  ): Promise<ServerToolResponse<string>>;
  uploadFile(
    guildId: string,
    serverId: string,
    sourceFile: string,
    targetPath: string,
  ): Promise<ServerToolResponse<string>>;
  downloadFile(
    guildId: string,
    serverId: string,
    file: string,
  ): Promise<ServerToolResponse<string>>;
}

export const server = {} as ServerTool;

/** MISC **/
// Read accessible servers from ./db/${guildId}/servers.json
const readServers = async (guildId: string) => {
  return await prisma.server.findMany({
    where: {
      guildId
    }
  })
};

/**
 * Checks if Steve has access to a server. If Steve does not have access, tries to grant Steve access. 
 * Returns a string of one of: "NO_ACCESS" | "NO_SERVER" | "INVALID_KEY" | "500" | "UNKNOWN" | "ALREADY_ACCESSIBLE" | "NO_FILE" | "ACCESS_GRANTED" | "INTERNAL_SERVER_ERROR" | "INCORRECT_FILE"
 */
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
        log.error("We have a problem folks. The initial request to Wepwawet is giving off an error.");
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
    log.error(err);
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
  if ((String(accessText.data)).trim() === String(guildId)) {

    // isOnline
    const isOnline = serverDetails.data.attributes.status === "running"

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
        information: JSON.stringify({
          id: serverId,
          name: serverName,
          description: serverDetails.data.attributes.description,
          type: isOnline ? type : "Type unknown: server is not running",
          version: isOnline ? type : "Version unknown: server not running",
          status: serverDetails.data.atrributes.status,
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
        }, null, 2),
        guildId,
        id: serverId,
        version,
        type,
        isOnline
      }
    })

    // Delete access file from remote server
    const data = await server.deleteFiles(guildId, serverId, "agentsteve.txt");

    if (data.success || data.code === 403) {
      return "ACCESS_GRANTED";
    }

    log.error(`The agentsteve.txt file could not be deleted. ${JSON.stringify(data, null, 2)}`);
    return "INTERNAL_SERVER_ERROR";
  }

  return "INCORRECT_FILE";
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

    // isOnline
    const isOnline = serverDetails.data.attributes.status === "running"

    // Get server version info
    const lastTypeAndVersion = await prisma.server.findFirst({
      where: {
        id
      },
      select: {
        type: true,
        version: true
      }
    });

    if (!lastTypeAndVersion) {
      await prisma.server.delete({
        where: {
          guildId,
          id
        }
      })
      continue;
    }

    let type = lastTypeAndVersion.type;
    let version = lastTypeAndVersion.version;
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
    const updatedServerInfo = JSON.stringify({
      id,
      name: serverDetails?.data?.attributes?.name,
      description: serverDetails.data.attributes.description,
      type,
      version,
      status: serverDetails.data.attributes.status,
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
    }, null, 2);

    // Update server
    await prisma.server.update({
      where: {
        guildId,
        id
      },
      data: {
        information: updatedServerInfo,
        version,
        type,
        isOnline
      }
    });
    serversArray.push({
        information: updatedServerInfo,
        version,
        type,
        isOnline
      });
  };

  return serversArray;
}


/**  FILE INTERACTION **/
// Deletes an array of file paths.
server.deleteFiles = async function (guildId: string, serverId: string, files: string[] | string) {
  if (!Array.isArray(files)) files = [files];

  if (!(await server.check(guildId, serverId))) {
    return { success: false, result: "The target server does not exist or you do not have access to it.", code: 401 };
  }

  try {
    await api.post(`/servers/${serverId}/files/delete`, {
      root: "/",
      files: files,
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, result: "The target file does not exist.", code: 404 };
      case 403:
        return { success: false, result: "You do not have permission: file.delete.", code: 403 };
      case 500:
        return { success: false, result: "The target file does not exist or an internal error occured.", code: 500 }
      default:
        return { success: false, result: "An unknown error has occured.", code: 500 };
    }
  }

  return { success: true, result: "The target file/files was/were successfully deleted.", code: 204 };
};

/**
 * Takes in an array of file paths and returns:
 * {
 *   success: boolean,
 *   result: [
 *     {
 *       success: boolean,
 *       path: string
 *       contents: string
 *       code: integer
 *     }
 *   ]
 * }
 */
server.readFiles = async function (guildId: string, serverId: string, files: string[] | string) {
  if (!Array.isArray(files)) files = [files];

  if (!(await server.check(guildId, serverId))) {
    return { success: false, result: "The target server does not exist or you do not have access to it.", code: 401 };
  }

  const data: {
    success: boolean;
    result: Array<{ success: boolean; path: string; contents: unknown; code: number }>;
  } = {
    success: true,
    result: []
  };

  for (const file of files) {
    const response = await this.readFile(serverId, file);
    data.result.push({
      success: response.success,
      path: file,
      contents: response.result,
      code: response.code,
    });
    if (!response.success) data.success = false;
  }

  return data;

}

/**
 * Takes in a file path and returns:
 * {
 *   success: boolean,
 *   path: string
 *   contents: string
 *   code: integer
 * }
 */
server.readFile = async function (serverId: string, file: string) {
  let response;
  try {
    response = await api.post(`/servers/${serverId}/files/contents`, {
      params: {
        file: file
      }
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, result: "The target file does not exist.", code: 404 };
      case 403:
        return { success: false, result: "You do not have permission: file.read.", code: 403 };
      case 500:
        return { success: false, result: "The target file does not exist or an internal error occured.", code: 500}
      default:
        return { success: false, result: "An unknown error has occured.", code: 500 };
    }
  }

  return { success: true, result: response.data, code: 200 };
}

// Takes in a file path and content and writes a file to the specified path
server.writeFile = async function (guildId: string, serverId: string, file: string, content: unknown) {

  if (!(await server.check(guildId, serverId))) {
    return { success: false, result: "The target server does not exist or you do not have access to it.", code: 401 };
  }

  try {
    const response = await api.post(`/servers/${serverId}/files/write`, content, {
      params: {
        file: file
      }
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, result: "The target server or directory does not exist or an internal error occured.", code: 404 };
      case 403:
        return { success: false, result: "You do not have permission: file.write.", code: 403 };
      case 500:
        return { success: false, result: "The target directory does not exist or an internal error occured.", code: 500 }
      default:
        return { success: false, result: "An unknown error has occured.", code: 500 };
    }
  }

  return { success: true, result: `The specified file, ${file}, has been written to.`, code: 204 };
}

// Uploads sourceFile to targetPath
// TODO: Uncompleted- needs to be completed
server.uploadFile = async function (guildId: string, serverId: string, sourceFile: string, targetPath: string) {
  if (!(await server.check(guildId, serverId))) {
    return { success: false, result: "The target server does not exist or you do not have access to it.", code: 401 };
  }

  // Get signed URL
  const uploadUrlResponse = await axios.get(
    `/servers/${serverId}/files/upload`,
    {
      params: {
        directory: targetPath
      }
    }
  );

  const signedUrl = uploadUrlResponse.data.attributes.url;

  // Upload file to signed URL
  const formData: any = new (FormData as any)();
  //formData.append('files', await fs.createReadStream(`./src/tools/downloads/${guildId}/${sourceFile}`)); // TODO: Idk why this is commented or what it is needs to be completed
  formData.append('directory', targetPath);

  try {
    const headers = typeof formData.getHeaders === "function" ? formData.getHeaders() : {};
    await axios.post(signedUrl, formData, { headers });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, result: "The target directory does not exist or an internal error occured.", code: 404 };
      case 403:
        return { success: false, result: "You do not have permission: file.upload.", code: 403 };
      case 500:
        return { success: false, result: "The target directory does not exist or an internal error occured.", code: 500 }
      default:
        return { success: false, result: "An unknown error has occured.", code: 500 };
    }
  }

  return { success: true, result: `The specified source file, ${sourceFile}, has been uploaded to ${targetPath}.`, code: 204 };

}

// Downloads file
server.downloadFile = async function (guildId: string, serverId: string, file: string) {
  if (!(await server.check(guildId, serverId))) {
    return { success: false, result: "The target server does not exist or you do not have access to it.", code: 401 };
  }

  try {
    await api.get(`/servers/${serverId}/files/download`, {
      params: {
        file: file
      },
      responseType: "stream"
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { success: false, result: "The target file does not exist.", code: 404 };
      case 403:
        return { success: false, result: "You do not have permission: file.download.", code: 403 };
      case 500:
        return { success: false, result: "The target file does not exist or an internal error occured.", code: 500 }
      default:
        return { success: false, result: "An unknown error has occured.", code: 500 };
    }
  }

  function removePath(str: string) {
    const lastIndex = str.lastIndexOf("/");

    // Check if there is path
    if (lastIndex === -1) {
      return str; // Return original string if path is not present
    } else {
      // Extract the substring starting from the /'s index + 1
      return str.substring(lastIndex + 1);
    }
  }

  try {
    //response.data.pipe(fs.createWriteStream(`./src/tools/downloads/${guildId}/${removePath(file)}`)); // TODO: Idk why this is commented or what it is needs to be completed
  } catch {
    return { success: false, result: `An internal error occured while trying to download the target file, ${file}.`, code: 500 }
  }

  return { success: true, result: `The target file, ${file}, was successfully downloaded.`, code: 204 };

}
