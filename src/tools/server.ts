import "dotenv/config";
import fs from "fs";
import fsp from "fs/promises";
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

export const server: any = {};

/** MISC **/
// Read accessible servers from ./db/${guildId}/servers.json
const readServers = async (guildId: string) => {
  try {
    return JSON.parse(await fsp.readFile(`./db/${guildId}/servers.json`, "utf8"));
  } catch {
    return {};
  }
};

/**
 * Checks if Steve has access to a server. If Steve does not have access, tries to grant Steve access. 
 * Returns a string of one of: "NO_ACCESS" | "NO_SERVER" | "INVALID_KEY" | "500" | "UNKNOWN" | "ALREADY_ACCESSIBLE" | "NO_FILE" | "ACCESS_GRANTED" | "INTERNAL_SERVER_ERROR" | "INCORRECT_FILE"
 */
server.addNew = async function (guildId: string, serverId: string) {
  const servers = await readServers(guildId);
  const serverIds = Object.keys(servers);

  let serverDetails: any;
  let serverStartup: any;
  try {
    serverDetails = await api.get(`/servers/${serverId}/`);
    serverStartup = await api.get(`/servers/${serverId}/startup`);
  } catch (err: any) {
    const status = err?.response?.status;
    if (serverIds.includes(serverId)) {
      delete servers[serverId];
      await fsp.writeFile(`./db/${guildId}/servers.json`, JSON.stringify(servers, null, 2));
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
    });
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) return "NO_FILE";
    if (status === 403) return "NO_ACCESS";
    if (status === 500) return "500";
    log.error(err);
    if (status === 401) return "INVALID_KEY";
    return "UNKNOWN";
  }

  // Write information to db/guildId/servers.json
  if ((String(accessText.data) || "").trim() === String(guildId)) {

    // Get server type and version
    const startupVars = Object.fromEntries(
      serverStartup.data.data.map((v: any) => [
        v.attributes.env_variable,
        v.attributes.server_value
      ])
    );
    const serverJar = startupVars.SERVER_JARFILE ?? null;
    const minecraftVersion =
      startupVars.MINECRAFT_VERSION ??
      startupVars.MC_VERSION ??
      null;

    // Add server to servers from servers.json
    servers[serverId] = {
      name: serverName,
      description: serverDetails.data.attributes.description,
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
      serverJar,
      minecraftVersion
    }

    // Write to servers.json
    await fsp.writeFile(`./db/${guildId}/servers.json`, JSON.stringify(servers, null, 2));

    // Delete access file from remote server
    const data = await server.deleteFiles(guildId, serverId, "agentsteve.txt");

    if (data.success || data.code === 403) {
      return "ACCESS_GRANTED";
    }

    log.error(JSON.stringify(data, null, 2));
    return "INTERNAL_SERVER_ERROR";
  }

  return "INCORRECT_FILE";
};

// Checks if a serverId matches an accessible server
server.check = async function (guildId: string, serverId: string) {
  const serverIds = Object.keys(await readServers(guildId));
  return serverIds.includes(serverId);
};

// Updates and returns servers.json
server.readAndUpdate = async function (guildId: string) {
  const servers = JSON.parse(await fsp.readFile(`./db/${guildId}/servers.json`, "utf8"));

  for (const key of Object.keys(servers)) {
    const serverId = key;

    let serverDetails: any;
    let serverStartup: any;
    try {
      serverDetails = await api.get(`/servers/${serverId}/`);
      serverStartup = await api.get(`/servers/${serverId}/startup`);
    } catch (err) {
      delete servers[serverId];
      continue;
    }

    const serverName = serverDetails?.data?.attributes?.name || servers?.[serverId]?.name || serverId;

    // Get server type and version
    const startupVars = Object.fromEntries(
      serverStartup.data.data.map((v: any) => [
        v.attributes.env_variable,
        v.attributes.server_value
      ])
    );
    const serverJar = startupVars.SERVER_JARFILE ?? null;
    const minecraftVersion =
      startupVars.MINECRAFT_VERSION ??
      startupVars.MC_VERSION ??
      null;

    // Add server to servers from servers.json
    servers[serverId] = {
      name: serverName,
      description: serverDetails.data.attributes.description,
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
      serverJar,
      minecraftVersion
    }
  };

  // Write to servers.json
  await fsp.writeFile(`./db/${guildId}/servers.json`, JSON.stringify(servers, null, 2));

  return servers;
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
  formData.append('files', await fs.createReadStream(`./src/tools/downloads/${guildId}/${sourceFile}`));
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

  let response;
  try {
    response = await api.get(`/servers/${serverId}/files/download`, {
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
    response.data.pipe(fs.createWriteStream(`./src/tools/downloads/${guildId}/${removePath(file)}`));
  } catch {
    return { success: false, result: `An internal error occured while trying to download the target file, ${file}.`, code: 500 }
  }

  return { success: true, result: `The target file, ${file}, was successfully downloaded.`, code: 204 };

}
