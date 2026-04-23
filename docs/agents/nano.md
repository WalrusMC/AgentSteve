# Agent: Nano

Source: `src/agents/nano.ts`

## Role

`nano()` is the lightweight responder. It decides whether to:

- answer the user directly with text and optional attached files
- escalate the request to `moderate()`

It is used only after `src/router.ts` decides the message looks simple enough to try the cheap path first.

## Model

- `models.general.low.slow`
- currently `gpt-5-nano`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Describes Steve and the nano responder role. |
| Developer prompt | Yes | Wrapped inside a JSON `developer` message that also includes resource info. |
| User prompt | Yes | JSON with `pastChats` and `currentUserMessage`. |
| Assistant prompt | Yes | JSON with a placeholder `memorySummary`. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | Time, author, content, attachments. |
| Assistant memory | Yes | Always present, but currently a hardcoded placeholder string. |
| Plugin metadata | Yes | Current guild plugins from Prisma, passed inside the developer message. |
| Download metadata | Yes | Current guild downloads from Prisma, passed inside the developer message. |
| Tool history | Yes | As a function argument, but only used if nano escalates to `moderate(info, toolHistory)`. |
| Code/project files | No | Nano never sees source code or plugin manifests. |
| Server inventory | No | Not included. |

## Tools

Nano can call exactly one function tool:

- `respond`
- `moderate`

### `respond`

Arguments:

- `responseText`
- `files[]`

`files[]` is restricted to file names already present in the guild downloads inventory.

### `moderate`

No arguments. It simply forwards to `moderate(info, toolHistory)`.

## Output behavior

- If the model calls `respond`, `sendMsgDiscord()` sends the message and optional files.
- If the model calls `moderate`, control passes to the higher-capability agent.

## What nano is good for

- simple explanations
- conversational replies
- answers that only require the current chat context
- sending already-downloaded files back to the user

## What nano explicitly avoids

Its developer prompt tells it to escalate instead of answering directly when the request needs:

- real-time or outside information
- tool use
- multi-step system behavior beyond plain text/files

## Current limits

- The memory summary is a placeholder and does not reflect real long-term memory.
- Nano can see plugin and download metadata, but it cannot inspect plugin source or server state directly.
