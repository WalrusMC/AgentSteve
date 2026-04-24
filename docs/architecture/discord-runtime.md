# Discord Runtime

## What This System Does

The Discord runtime is the user-facing entrypoint for AgentSteve. It logs into Discord, registers guild records, accepts administrator mentions, gathers context, prepares resources, routes the request through the agent stack, and sends the final Discord replies.

The implementation is centered in `src/index.ts`. It is started by `app.ts`.

## How It Works

Startup behavior:

1. `app.ts` imports `src/index.ts`.
2. `src/index.ts` creates a Discord client with guild, message, direct-message, message-content, reaction, and poll intents.
3. `client.login(process.env.DISCORD_TOKEN)` starts the bot.
4. On `clientReady`, Steve creates a downloads folder for each guild and upserts each guild into Prisma.
5. On `guildCreate`, Steve creates the new guild's downloads folder and upserts the guild row.

Message behavior:

1. Ignore bot messages, `@everyone`, DMs, messages that do not mention Steve, and non-admin users.
2. Reject concurrent requests for the same guild with `currentlyRunning[guildId]`.
3. Load known guild servers and open Pterodactyl websocket connections.
4. Build `AgentInfo` with guild id, Discord message, and recent chat context from `getPastChats()`.
5. Download attached files into `src/tools/downloads/<guildId>/` and create `Download` rows.
6. If the message contains Google Doc links, pre-run `gdoc.read()`.
7. Route to the previous clarification responder, the main router, or the placeholder complex responder.
8. Suppress embeds on sent messages when possible.
9. Clear typing and concurrency state in `finally`.

Long responses and file attachments are sent through `src/tools/sendMsgDiscord.ts`.

## System Map

```mermaid
flowchart TD
    App[app.ts] --> Index[src/index.ts]
    Index --> Login[client.login DISCORD_TOKEN]

    Login --> Ready[clientReady]
    Ready --> EnsureDirs[ensure downloads folder per guild]
    Ready --> UpsertGuild[(upsert Guild rows)]

    Login --> GuildCreate[guildCreate]
    GuildCreate --> EnsureNewDir[ensure new guild downloads folder]
    GuildCreate --> UpsertNewGuild[(upsert new Guild row)]

    Login --> MessageCreate[messageCreate]
    MessageCreate --> Gates{valid request?}
    Gates -->|no| Ignore[ignore or permission reply]
    Gates -->|yes| Concurrency{guild already running?}
    Concurrency -->|yes| BusyReply[slow down reply]
    Concurrency -->|no| SetRunning[currentlyRunning true]

    SetRunning --> Typing[start typing interval]
    SetRunning --> Servers[load Prisma Server rows]
    Servers --> WS[pterodactylWS.connect]
    SetRunning --> PastChats[getPastChats]
    SetRunning --> AgentInfo[build AgentInfo]
    SetRunning --> Attachments{attachments?}
    Attachments -->|yes| SaveFiles[download and create Download rows]
    Attachments -->|no| DocCheck
    SaveFiles --> DocCheck{Google Doc links?}

    DocCheck -->|yes| PreRead[gdoc.read]
    DocCheck -->|no| ToolHistory[toolHistory]
    PreRead --> ToolHistory
    ToolHistory --> Clarify{clarification responder stored?}
    Clarify -->|moderate| Moderate[src/agents/moderate.ts]
    Clarify -->|complex| Complex[complex placeholder]
    Clarify -->|none| Router[src/router.ts]

    Router --> Response[ResponderResponse]
    Moderate --> Response
    Complex --> Response
    Response --> IsClarification{is clarification?}
    IsClarification -->|yes| StoreClarification[clarifications guildId responder]
    IsClarification -->|no| SuppressEmbeds[suppress embeds]
    StoreClarification --> Finally[clear typing and running]
    SuppressEmbeds --> Finally
```

## Problems, Limitations, And Notes

- `currentlyRunning` is process-local. It does not coordinate across multiple Node processes.
- `clarifications[guildId]` is process-local and is not cleared after a normal follow-up.
- The complex responder branch replies with placeholder text.
- Startup comments still mention command registration, but no Discord commands are registered.
- Attachment downloads trust Discord attachment URLs and save files by sanitized base name only.
- `ensureDownloadPath()` creates only one directory level and does not use `{ recursive: true }`.
- Google Doc pre-read returns early for auth and permission failures because `gdoc.read()` sends the auth message itself.
- Very large docs are rejected at the Discord runtime before routing. Document summarization is TODO.
- The file imports `architect` and `arch` for temporary testing, but they are unused in the runtime path.
