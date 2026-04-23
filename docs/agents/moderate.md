# Agent: Moderate

Source: `src/agents/moderate.ts`

## Role

`moderate()` is the main operational responder. It is responsible for:

- tool orchestration
- plugin creation requests
- Google Doc reads
- server power actions
- clarification questions
- final user-facing replies

It is the most important user-facing agent in the current system.

## Model

- `models.general.medium.slow`
- currently `gpt-5-mini`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Describes Steve and the moderation/tool-orchestration role. |
| Developer prompt | Yes | JSON with the tool-usage loop instructions. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Assistant prompt | Yes | JSON with `toolHistory` and the current resource snapshot. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | Time, author, content, attachments. |
| Tool history | Yes | Every tool result from the current request chain. |
| Plugin metadata | Yes | Current guild plugins from Prisma. |
| Download metadata | Yes | Current guild downloads from Prisma. |
| Server inventory | Yes | Refreshed server data from `server.readAndUpdate()`. |
| Code/project files | No | It does not see source code directly. |
| Assistant memory | No | No memory summary is provided here. |

## Tools

`moderate()` registers these tools with the OpenAI Responses API:

- built-in `web_search`
- `respond`
- `createNewPlugin`
- `clarify`
- `readDoc`
- `serverPower`

### `respond`

Sends the final text reply and optional downloaded files.

### `createNewPlugin`

Starts the plugin pipeline with:

- `pluginName`
- a structured assistant-side summary of the requested plugin

### `clarify`

Sends a follow-up question and marks the response as a clarification.

### `readDoc`

Requests specific Google Doc IDs extracted from the user message.

### `serverPower`

Performs one power action on one enrolled server.

## Control loop

This agent is implemented as a recursive loop:

1. ask the model for one tool call
2. execute it
3. append the result to `toolHistory`
4. call `moderate()` again

The loop ends when the model calls `respond()`.

## Downstream systems it can trigger

- plugin pipeline
- Google Docs API
- Pterodactyl server power API
- Discord replies

## Important maintenance notes

- User-facing editing of existing plugins is intentionally blocked. The system prompt tells `moderate()` to explain that plugin editing is not implemented yet.
- The built-in `web_search` tool is declared, but the current implementation only looks for `function_call` outputs. That means the tool loop is not fully generalized for all Responses API tool types.
- Server file tools exist in the codebase but are not exposed from `moderate()`.
