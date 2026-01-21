import "dotenv/config";
import axios from "axios";
import { createLogger } from "../../utils/logger.js";
import type { ToolResult } from "../../types.js";
import { server } from "./server.js";
import { prisma } from "../../../lib/prisma.js";
import fs from "fs/promises";
import path from "path";

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

export interface ServerFiles {
  deleteMany(
    guildId: string,
    serverId: string,
    files: string[] | string,
  ): Promise<ToolResult<string, { reason: string, code: number }>>;
  readMany(
    guildId: string,
    serverId: string,
    files: string[] | string,
  ): Promise<ToolResult<{ contents: string, path: string }, { reason: string, code: number }>[]>;
  read(serverId: string, file: string): Promise<ToolResult<{ contents: string, path: string }, { reason: string, code: number }>>;
  write(
    guildId: string,
    serverId: string,
    file: string,
    content: unknown,
  ): Promise<ToolResult<string, { reason: string, code: number }>>;
  upload(
    guildId: string,
    serverId: string,
    sourceFile: string,
    targetPath: string,
  ): Promise<ToolResult<string, { reason: string, code: number }>>;
  download(
    guildId: string,
    serverId: string,
    file: string,
  ): Promise<ToolResult<string, { reason: string, code: number }>>;
}

export const file = {} as ServerFiles;

async function ensureGuildDownloadPath(guildId: string) {
  const dir = path.join(process.cwd(), "src", "tools", "downloads", guildId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function getUniqueName(dir: string, baseName: string) {
  const safe = baseName.replace(/[\\/]/g, "_");
  const dot = safe.lastIndexOf(".");
  const name = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";

  let attempt = 0;
  let candidate = safe;
  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
      attempt += 1;
      candidate = `${name}-${attempt}${ext}`;
    } catch {
      return candidate;
    }
  }
}

// Deletes an array of file paths.
file.deleteMany = async function (guildId: string, serverId: string, files: string[] | string) {
  const name = "server.file.deleteMany";
  if (!Array.isArray(files)) files = [files];

  if (!(await server.check(guildId, serverId))) {
    return { name, success: false, error: { reason: "The target server does not exist or you do not have access to it.", code: 401 } };
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
        return { name, success: false, error: { reason: "The target file does not exist.", code: 404 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have permission: file.delete.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: "The target file does not exist or an internal error occured.", code: 500 } }
      default:
        return { name, success: false, error: { reason: "An unknown error has occured.", code: 500 } };
    }
  }

  return { name, success: true, result: `The target file/files (${files}) was/were successfully deleted.` };
};


file.readMany = async function (guildId: string, serverId: string, files: string[] | string) {
  const name = "server.file.readMany";
  if (!Array.isArray(files)) files = [files];

  if (!(await server.check(guildId, serverId))) {
    return [{ name, success: false, error: { reason: `The target server does not exist or you do not have access to it. Server ID: ${serverId} Files: ${files}`, code: 401 } }];
  }

  const data: ToolResult<{ contents: string, path: string }, { reason: string, code: number }>[] = [];

  for (const filePath of files) {
    const response = await file.read(serverId, filePath);
    data.push(response);
  }

  return data;

}

file.read = async function (serverId: string, file: string) {
  const name = "server.file.read";
  let response;
  try {
    response = await api.get(`/servers/${serverId}/files/contents`, {
      params: { file },
      responseType: "text",
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { name, success: false, error: { reason: `The target file ${file} does not exist.`, code: 404 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have this permission: file.read.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: `The target file ${file} does not exist or an internal error occured.`, code: 500 } }
      default:
        return { name, success: false, error: { reason: "An unknown error has occured. Do not call this tool again.", code: 500 } };
    }
  }

  return { name, success: true, result: { contents: response.data, path: file } };
}

// Takes in a file path and content and writes a file to the specified path
file.write = async function (guildId: string, serverId: string, file: string, content: unknown) {
  const name = "server.file.write";

  if (!(await server.check(guildId, serverId))) {
    return { name, success: false, error: { reason: "The target server does not exist or you do not have access to it.", code: 401 } };
  }

  try {
    const body =
      typeof content === "string"
        ? content
        : content == null
          ? ""
          : JSON.stringify(content, null, 2);

    await api.post(`/servers/${serverId}/files/write`, body, {
      params: {
        file: file
      },
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { name, success: false, error: { reason: "The target server or directory does not exist or an internal error occured.", code: 404 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have permission: file.write.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: "The target directory does not exist or an internal error occured.", code: 500 } }
      default:
        return { name, success: false, error: { reason: "An unknown error has occured.", code: 500 } };
    }
  }

  return { name, success: true, result: `The specified file, ${file}, has been written to.` };
}

// Uploads sourceFile to targetPath
file.upload = async function (guildId: string, serverId: string, sourceFile: string, targetPath: string) {
  const name = "server.file.upload";
  if (!(await server.check(guildId, serverId))) {
    return { name, success: false, error: { reason: "The target server does not exist or you do not have access to it.", code: 401 } };
  }

  const localPath = path.join(process.cwd(), "src", "tools", "downloads", guildId, sourceFile);
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(localPath);
  } catch {
    return { name, success: false, error: { reason: `The source file (${sourceFile}) does not exist in downloads for this guild.`, code: 404 } };
  }

  let signedUrl: string | undefined;
  try {
    const uploadUrlResponse = await api.get(`/servers/${serverId}/files/upload`, {
      params: { directory: targetPath },
    });
    signedUrl = uploadUrlResponse?.data?.attributes?.url;
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { name, success: false, error: { reason: "The target directory does not exist or an internal error occured.", code: 404 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have permission: file.upload.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: "The target directory does not exist or an internal error occured.", code: 500 } }
      default:
        return { name, success: false, error: { reason: "An unknown error has occured.", code: 500 } };
    }
  }

  if (!signedUrl) {
    return { name, success: false, error: { reason: "Failed to retrieve a signed upload URL.", code: 500 } };
  }

  const formData = new FormData();
  const bytes = new Uint8Array(
    fileBuffer.buffer as ArrayBuffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength,
  );
  formData.append("files", new Blob([bytes]), path.posix.basename(sourceFile));
  formData.append("directory", targetPath);

  try {
    const uploadRes = await fetch(signedUrl, { method: "POST", body: formData });
    if (!uploadRes.ok) {
      return { name, success: false, error: { reason: `Upload failed (${uploadRes.status}).`, code: uploadRes.status } };
    }
  } catch {
    return { name, success: false, error: { reason: "An unknown error has occured while uploading.", code: 500 } };
  }

  return { name, success: true, result: `The specified source file, ${sourceFile}, has been uploaded to ${targetPath}.` };

}

// Downloads file
file.download = async function (guildId: string, serverId: string, file: string) {
  const name = "server.file.download";
  if (!(await server.check(guildId, serverId))) {
    return { name, success: false, error: { reason: "The target server does not exist or you do not have access to it.", code: 401 } };
  }

  let signedUrl: string | undefined;
  try {
    const urlRes = await api.get(`/servers/${serverId}/files/download`, {
      params: { file },
    });
    signedUrl = urlRes?.data?.attributes?.url;
  } catch (err: any) {
    const status = err?.response?.status;
    switch (status) {
      case 404:
        return { name, success: false, error: { reason: "The target file does not exist.", code: 404 } };
      case 403:
        return { name, success: false, error: { reason: "You do not have permission: file.download.", code: 403 } };
      case 500:
        return { name, success: false, error: { reason: "The target file does not exist or an internal error occured.", code: 500 } }
      default:
        return { name, success: false, error: { reason: "An unknown error has occured.", code: 500 } };
    }
  }

  if (!signedUrl) {
    return { name, success: false, error: { reason: "Failed to retrieve a signed download URL.", code: 500 } };
  }

  try {
    const dir = await ensureGuildDownloadPath(guildId);
    const baseName = path.posix.basename(file);
    const savedName = await getUniqueName(dir, baseName);
    const outPath = path.join(dir, savedName);

    const downloadRes = await fetch(signedUrl);
    if (!downloadRes.ok) {
      return { name, success: false, error: { reason: `Download failed (${downloadRes.status}).`, code: downloadRes.status } };
    }
    const arrayBuffer = await downloadRes.arrayBuffer();
    await fs.writeFile(outPath, Buffer.from(arrayBuffer));

    await prisma.download.create({
      data: {
        file: savedName,
        description: `Downloaded from server ${serverId}: ${file}`,
        guildId,
      }
    });

    return { name, success: true, result: `The target file, ${file}, was downloaded as ${savedName}.` };
  } catch {
    return { name, success: false, error: { reason: `An internal error occured while trying to download the target file, ${file}.`, code: 500 } }
  }

}
