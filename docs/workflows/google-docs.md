# Workflow: Google Docs Access

`AgentSteve` supports reading Google Docs links shared in Discord, but the flow depends on per-user OAuth tokens stored for each guild.

## Moving parts

- `src/tools/google.ts` handles document access.
- `src/api/controllers/googleOAuth.ts` stores OAuth tokens.
- `src/index.ts` pre-reads docs mentioned in Discord messages.
- `src/agents/moderate.ts` can also call `readDoc` as a tool.

## 1. OAuth callback flow

The internal API route is:

- `POST /internal/aiagents/steve/oauth/google/callback`

It expects:

- `token`
- `guild`
- `user`

If all three are present, it upserts `GuildUser` by `(userId, guildId)` and stores the token in the `token` JSON field.

## 2. Token lookup during reads

When `gdoc.read()` runs, it:

1. finds the `GuildUser` row for `(message.author.id, guildId)`
2. reads `user.token`
3. creates a fresh OAuth client
4. generates an authorization URL in case the token is missing or invalid

If the token is missing, the bot replies with an OAuth link and returns `NO_AUTH`.

## 3. How document IDs are found

`gdoc.extractIds(content)` splits on `https://docs.google.com/document/d/` and extracts document IDs from the trailing path or next space.

`gdoc.read()` can work in two modes:

- parse IDs out of message text
- use an explicit `ids[]` array provided by `moderate()`

## 4. Document fetch and parsing

For each doc ID, `gdoc.read()` calls:

- `docs.documents.get({ documentId, includeTabsContent: true })`

It then recursively converts Google tabs into:

- `title`
- `content`
- optional `subTabs[]`

The final success payload includes:

- `sizePerDocument`
- total `size`
- `documents[]`

## 5. Where the read flow is used

### In `src/index.ts`

If the Discord message includes a Google Docs URL:

- the message handler calls `gdoc.read()` before routing
- successful results are pushed into `toolHistory`
- auth failures can end the request early
- oversized docs cause an immediate reply and stop

### In `src/agents/moderate.ts`

`moderate()` exposes a `readDoc` function tool.

If the model calls it:

- the tool result is normalized into `toolHistory`
- `moderate()` is called again

That lets the model request docs after initial routing if needed.

## 6. Size handling

The current size logic is simple:

- total size over `20000` characters -> reject
- total size over `5000` characters -> marked as a future rate-limiting concern

The message handler treats oversized docs as too large to read. `moderate()` also converts oversized tool reads into a tool-history failure entry so the model does not keep retrying.

## 7. Error mapping

`gdoc.read()` normalizes failures into:

- `NO_DOCS`
- `NO_AUTH`
- `NOT_FOUND`
- `FORBIDDEN`
- `UNKNOWN`

`moderate()` then turns those into either:

- early silent return, if the tool already messaged the user
- a tool-history error entry
- or a generic bot error if something impossible happened

## 8. Current caveats

- `GuildUser.token` is a Prisma `Json?` field, but `gdoc.read()` only parses the token when it is a string. In `googleOAuth.ts`, create and update paths store the token differently. That mismatch can make valid stored tokens behave like missing auth.
- Doc reads are driven only by message text or explicit IDs; there is no document search or listing flow.
- Large documents are rejected instead of summarized. The code already has TODO comments for future summarization.
