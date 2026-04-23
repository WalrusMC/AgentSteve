# Workflow: Discord Message Routing

This file describes the path from a Discord mention to a final reply.

## 1. Process startup

`app.ts` imports:

- `src/index.ts` for the Discord bot
- `src/api/server.ts` for the internal API

When the Discord client becomes ready, `src/index.ts`:

- logs in
- creates a downloads folder for each guild
- upserts each guild into Prisma

It does the same guild setup when the bot joins a new guild.

## 2. Message gatekeeping

Every message goes through a set of early exits in `client.on("messageCreate")`.

The bot ignores:

- bot authors
- `@everyone` mentions
- messages without a `guildId`
- messages that do not mention the bot user

It also rejects:

- non-admin users with a warning reply
- concurrent guild requests while `currentlyRunning[guildId]` is true

This means Steve is effectively single-threaded per guild.

## 3. Per-message setup

For an accepted message, the bot:

1. Loads all `Server` rows for the guild.
2. Opens websocket connections for those servers through `pterodactylWS.connect()`.
3. Builds `AgentInfo`:
   - `guildId`
   - `message`
   - `pastChats`
4. Creates an empty `toolHistory[]`.
5. Starts a typing indicator loop.

`getPastChats(message, 2100)` fetches recent channel messages, excludes the current one, and returns a simplified chronological chat history capped by approximate content length.

## 4. Attachment ingestion

If the message has attachments, `src/index.ts`:

- ensures `src/tools/downloads/<guildId>/` exists
- downloads each attachment
- de-duplicates names by appending `-1`, `-2`, and so on
- writes the file locally
- inserts a `Download` row describing the saved file

This is why later agents can attach those files back to Discord.

## 5. Google Docs pre-read

Before routing, the message handler checks whether the raw message content contains `https://docs.google.com/document/d/`.

If it does, `gdoc.read()` runs immediately.

Possible outcomes:

- `NO_AUTH` or `FORBIDDEN`
  - The tool itself replies with an OAuth link or permission message.
  - The message handler returns early.
- success
  - The doc content is added to `toolHistory`.
- too large
  - The handler replies with a size warning and stops.
- other failures
  - The failure is added to `toolHistory` so downstream agents can react.

This pre-read means docs can already be available to `moderate()` before it decides to call tools itself.

## 6. Clarification shortcut

The handler keeps an in-memory `clarifications[guildId]` map.

If a guild is currently marked as:

- `"moderate"` -> call `moderate()` directly
- `"complex"` -> return a complex placeholder reply
- otherwise -> use the normal router

Important maintenance note:

- clarification state is set when a responder asks a clarification question
- the code never clears it after a normal answer
- so clarification mode can remain active indefinitely until process restart

## 7. Normal routing

If no clarification shortcut is active, `src/router.ts` runs:

1. `classifier(info)` returns routing flags.
2. If one of the "complex" flags is true, return the complex placeholder.
3. Else if any routing flag is true, call `moderate(info, toolHistory)`.
4. Else call `nano(info, toolHistory)`.

Current caveat:

- `router.ts` checks `needs_code_execution_or_debugging_or_testing`
- `classifier.ts` actually returns `needs_iterative_code_execution_or_debugging`
- so that particular complex-routing branch is currently disconnected

## 8. Nano path

`nano()` receives:

- `pastChats`
- `currentUserMessage`
- a developer-side inventory of known plugins and downloads
- an assistant-side placeholder memory summary

It can only choose one tool:

- `respond`
- `moderate`

If the request is simple text-only work, it replies directly. Otherwise it forwards to `moderate()`.

## 9. Moderate path

`moderate()` receives:

- `pastChats`
- `currentUserMessage`
- accumulated `toolHistory`
- current `plugins`, `downloads`, and `servers`

It then runs a recursive one-tool-at-a-time loop:

- ask the model for exactly one tool call
- execute it
- append the result to `toolHistory`
- call `moderate()` again

The loop ends only when the model calls `respond()`.

## 10. Response delivery

The final `ResponderResponse` contains:

- `messages`
- `isClarification`
- `responder`

If the response is a clarification, the handler stores that responder name in `clarifications[guildId]`.

If the response is a normal reply, the handler tries to suppress embeds on each sent message.

The typing interval is always cleared in `finally`, and `currentlyRunning[guildId]` is reset to `false`.

## Failure behavior

If anything in the message handler throws:

- the error is logged
- the bot attempts to reply with `Sorry, I hit an error while handling that.`

This is the outermost safety net for Discord-side failures.
