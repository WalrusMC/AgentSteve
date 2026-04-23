# Workflow: Server Access And Control

This file documents how `AgentSteve` enrolls and interacts with remote Minecraft servers through Pterodactyl.

## Main modules

- `src/tools/server/server.ts`
- `src/tools/server/files.ts`
- `src/tools/server/websocket.ts`
- `src/api/controllers/serverAccess.ts`

## 1. Server enrollment flow

The internal API route:

- `POST /internal/aiagents/steve/serveraccess/check`

calls `server.addNew(guildId, serverId)`.

That method:

1. verifies the server exists through the Pterodactyl client API
2. checks whether Steve already has a matching `Server` row
3. reads `/agentsteve.txt` from the remote server
4. expects the file contents to equal the guild ID
5. if valid, stores the server in Prisma
6. tries to delete `agentsteve.txt`

This `agentsteve.txt` file is the proof-of-access handshake.

## 2. Stored server metadata

When access is granted, Prisma stores:

- server ID
- guild ID
- cached `data` JSON with name, description, specs, IP, ports, type, version, and status
- `type`
- current `status`

If the server is already running, `server.addNew()` also tries to determine:

- server software type
- Minecraft version

It does that by sending `version` over the websocket layer.

## 3. Keeping servers warm in Discord flow

On every accepted Discord message, `src/index.ts` loads all servers for the guild and calls:

- `pterodactylWS.connect(serverIds)`

That means websocket connections are established or refreshed lazily as users interact with Steve.

## 4. Websocket behavior

`src/tools/server/websocket.ts` manages:

- one websocket per server in `sockets`
- outstanding command promises in `pendingCommands`

When connected:

- console output lines are stored in `ConsoleLine`
- status changes update `Server.status`
- command results are inferred by sending a command plus a sentinel line like `STEVE:<id>:COMMAND`

The command flow is:

1. send `<command>\nSTEVE:<id>:COMMAND`
2. wait for the sentinel to appear in console output
3. collect console lines after the command line
4. treat lines containing `[91m` as execution failure
5. resolve success or failure

## 5. Server refresh flow

`server.readAndUpdate(guildId)`:

- reloads each known server from the HTTP API
- removes stale DB records when the server is gone
- refreshes the cached `data` JSON
- keeps the stored `status`
- refreshes type/version via websocket if the server is running

`moderate()` uses this method before building its assistant-side resource context.

## 6. Power actions

`server.power(serverId, signal)` supports:

- `start`
- `stop`
- `restart`
- `kill`

It hits the Pterodactyl power endpoint and returns a normalized `ToolResult`.

This is the only server action currently exposed to the `moderate()` agent as an LLM tool.

## 7. File actions

`src/tools/server/files.ts` already implements:

- `deleteMany()`
- `readMany()`
- `read()`
- `write()`
- `upload()`
- `download()`

These methods:

- check that the server is enrolled for the guild
- call the matching Pterodactyl file endpoint
- normalize errors into `ToolResult`
- use the guild downloads folder for uploads and downloads
- create `Download` rows for downloaded files

Even though this subsystem exists, it is not currently exposed from `moderate()` to the model.

## 8. Failure modes to know

- No access to the remote server -> `NO_ACCESS`
- Missing server -> `NO_SERVER`
- Invalid API token -> `INVALID_KEY`
- Missing or invalid `agentsteve.txt` -> `NO_FILE` or `INCORRECT_FILE`
- Build-up of console history is cleaned only when a websocket disconnects after being idle long enough
- `sendCommand()` requires the server to be running and the websocket to already be open

## 9. Design summary

The server subsystem is split cleanly into:

- HTTP API for metadata, power, and file operations
- websocket stream for status and console-driven command results
- Prisma for access control and cached state

The missing piece is not the low-level server code. The missing piece is wiring more of it into the agent layer.
