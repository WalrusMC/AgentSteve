import axios from "axios";
import WebSocket from "ws"
import { createLogger } from "../../utils/logger.js";
import { prisma } from "../../../lib/prisma.js";

import type { ToolResult } from "../../types.js";

const log = createLogger("websocket");

const PANEL_URL = "https://panel.wepwawet.net";
const API_KEY = process.env.WEPWAWET_TOKEN;

type SendCommandTR = ToolResult<string, { result: string, code: "NO_CONNECTION" | "TIMED_OUT" | "EXECUTION" | "OFFLINE"}>;

type PterodactylWS = {
  sockets: Map<string, { socket: WebSocket, lastActive: Date}>,
  pendingCommands: Map<Number, { resolve(value: string[], success: boolean): void, reject(): void, timeout: NodeJS.Timeout, command: string }>,
  connect(serverIds: string[]): void,
  connectServer(serverId: string): void,
  sendCommand(serverId: string, command: string): Promise<SendCommandTR>
}

type Handlers = {
  onMessage(serverId: string, msg: string): void,
  onClose(serverId: string): void,
  onError(serverId: string, err: Error): void,
  onStatusChange(serverId: string, status: string): void,
}

async function connectToServer(serverId: string, handlers: Handlers) {
  const res = await axios.get(
    `${PANEL_URL}/api/client/servers/${serverId}/websocket`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const { token, socket } = res.data.data;

  const ws = new WebSocket(socket, {
    headers: { Origin: PANEL_URL },
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({
      event: "auth",
      args: [token],
    }));
    log.info(`Connected to ${serverId}`);
  });

  ws.on("message", (data: string) => {
    const parsedData = JSON.parse(data.toString());
    if (parsedData.event === "console output") {
      for (const line of parsedData.args) {
        handlers.onMessage(serverId, line.trim());
      }
    }
    if ((parsedData.event === "token expiring") || (parsedData.event === "jwt error")) {
      ws.close(1000);
      handlers.onClose(serverId);
    }
  });

  ws.on("close", () => {
    handlers.onClose(serverId);
  })

  return ws;
}


export const pterodactylWS: PterodactylWS = {
  sockets: new Map(),
  pendingCommands: new Map(),

  connect: async function(serverIds: string[]) {
    for (const serverId of serverIds) {
      await this.connectServer(serverId);
    }
  },

  // Tries to connect a websocket to the target server if not already connected. Updates the lastActive time.
  connectServer: async function(serverId) {
    let entry = this.sockets.get(serverId);
    if (entry) return entry.lastActive = new Date();

    const ws = await connectToServer(serverId, {
      onMessage: async (id: string, msg: string) => {
        log.debug(JSON.stringify([msg], null, 2));
        if (!((new RegExp("STEVE:.*:COMMAND")).test(msg))) {
          // Save consoleLine
          await prisma.consoleLine.create({
            data: {
              serverId,
              line: msg
            }
          });
        } else {
          // Resolve commands
          const cmdKey = Number(msg.substring(msg.indexOf("STEVE:") + 6, msg.indexOf(":COMMAND")))
          if (msg === `STEVE:${cmdKey}:COMMAND`) return;

          // Delete the unkown or incomplete command message for the command key
          const msgToDelete = await prisma.consoleLine.findFirst({
            where: {
              serverId,
              line: {
                contains: "Unknown or incomplete command. See below for error"
              },
            },
            orderBy: {
              createdAt: "desc"
            }
          });

          if (msgToDelete) {
            await prisma.consoleLine.delete({
              where: {
                serverId,
                id: msgToDelete.id
              }
            });
          }

          await (new Promise(resolve => setTimeout(resolve, 1000)));

          const cmd = this.pendingCommands.get(cmdKey);
          if (!cmd) return;

          // The line that ran the command
          const cmdEntry = await prisma.consoleLine.findFirst({
            where: {
              serverId,
              line: cmd.command
            },
            orderBy: {
              createdAt: "desc"
            }
          });

          // Every logged line from the line that ran the command to the most recent line
          const consoleMessages = (await prisma.consoleLine.findMany({
            where: {
              serverId,
              createdAt: {
                gt: cmdEntry?.createdAt
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          })).map(obj => obj.line);

          let success = true;
          for (const line of consoleMessages) {
            if (line.trim().includes("[91m")) success = false;
          }

          cmd.resolve(consoleMessages, success);
          this.pendingCommands.delete(cmdKey);
        }
      },
      onClose: async (id: string) => {
        entry = this.sockets.get(serverId);
        if (!entry) return;
        if ((new Date().getTime()) - (entry.lastActive.getTime()) >= 1000 * 60 * 60) { // Checks how old lastActive time is. milliseconds * seconds * minutes
          log.info(`[${id}] has timed out and is disconnecting. Deleting logs...`);
          await prisma.consoleLine.deleteMany({
            where: {
              serverId: id
            }
          });
          this.sockets.delete(id);
          return;
        }

        this.sockets.delete(id);
        console.warn(`[${id}] disconnected, reconnecting...`);
        setTimeout(() => this.connectServer(id), 3000);
      },
      onError: (id: string, err: Error) => {
        console.error(`[${id}] WS error`, err);
      }, // Not used for anything rn
      onStatusChange: async (id: string, status: string) => {
        // TODO: Update server status on change- only problem is that server status is stored in information a JSON string and not just on prisma model. Might need to change that.
      }
    });

    this.sockets.set(serverId, { socket: ws, lastActive: new Date() });
  },

  sendCommand: async function(serverId, command) {
    const isOnline = await prisma.server.findFirst({
      where: {
        id: serverId
      },
      select: {
        isOnline: true
      }
    });
    if (!isOnline?.isOnline) return { name: "server.sendCommand", success: false, error: { result: "Server is offline", code: "OFFLINE" }}
    const entry = this.sockets.get(serverId);
    if (!entry) return { name: "server.sendCommand", success: false, error: { result: "No web socket connection", code: "NO_CONNECTION" } };
    const ws = entry.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return { name: "server.sendCommand", success: false, error: { result: "No web socket connection", code: "NO_CONNECTION" } };

    const cmdKey = Math.round(Math.random() * 1000000) // Command ID

    // Timeout or return the command result (following console lines)
    return new Promise((resolve) => {
      // Timeout
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(cmdKey);
        resolve({
          name: "server.sendCommand",
          success: false,
          error: { result: "Timed out.", code: "TIMED_OUT" }
        });
      }, 5000);

      // Add command to pendingCommands map
      this.pendingCommands.set(cmdKey, {
        resolve: (value: string[], success: boolean) => {
          const toolResult: SendCommandTR = success ? {
            name: "server.sendCommand",
            success: true,
            result: value.join("\n")
          } : {
            name: "server.sendCommand",
            success: false,
            error: {
              result: value.join("\n"),
              code: "EXECUTION"
            }
          };
          resolve(toolResult);
        },
        reject: () => {},
        timeout,
        command
      });

      // Send command along with key
      ws.send(JSON.stringify({
        event: "send command",
        args: [`${command}\nSTEVE:${cmdKey}:COMMAND`]
      }));
    });
  }
};
