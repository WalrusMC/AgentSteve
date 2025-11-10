# Agent Steve — WalrusMC Events Discord Bot

Agent Steve is a Discord bot used by WalrusMC Events staff. It listens for permitted staff mentions, summarizes recent channel context, routes the request to OpenAI for reasoning, and replies in Discord. It can also build and return custom Paper 1.20.1 Minecraft plugins on demand via a tools workflow.

## Features
- Staff‑only mention trigger with role gating.
- Live typing indicator and safe single‑run guard.
- Context summarization of recent channel chat.
- Smart routing to OpenAI with tool calling (forward/respond).
- Sends long replies split into 2000‑char chunks and can attach files.
- Java 17 + Maven plugin builder for Paper 1.20.1.

## Requirements
- Node.js 18.17+ (discord.js v14 requirement)
- A Discord bot with required privileged intents enabled in the Developer Portal:
  - MESSAGE CONTENT, GUILD MEMBERS, DIRECT MESSAGES (as used by code)
- OpenAI API key
- For plugin building: Java 17 and Maven (mvn) on PATH
- For GitHub access: GitHub Personal Access Token with repo permissions

## Setup
1. Clone the repo and install deps
   ```bash
   npm install
   ```
2. Create `.env` (see `.env.example`) and add:
   - `TOKEN` — Discord Bot Token
   - `CLIENT_ID`, `WMC_GUILD_ID`/`TEST_GUILD_ID` as needed
   - `CORETEAM_ROLE_ID`, `TEST_ROLE_ID`, `EVERY_ROLE_ID` — comma‑separated IDs permitted to invoke Steve
   - `EVERY_CAT_ID` — comma‑separated category IDs for support tickets
   - `OPENAI_API_KEY` — your OpenAI API key (required by the OpenAI SDK)
   - `GITHUB_TOKEN` — GitHub token with access to the repos you want Steve to read/commit
3. Optional logging config in `devVariables.js`:
   - `logAmount`: 0 (few), 1 (some), 2 (verbose)
   - `logResponse`: `true|false` (logs OpenAI responses)

## Run
```bash
node app.js
```
The bot logs in and listens for messages. Users with roles in `EVERY_ROLE_ID` can mention the bot to invoke it.

## How It Works
- `src/index.js`
  - Creates the Discord client and listens to `messageCreate`.
  - Verifies role + mention, shows typing, prevents concurrent runs.
  - Calls `summarizer(message)`; then `router(message, summary)` and sends the response; suppresses embeds.
- `src/summarizer.js`
  - Fetches ~30 recent messages, builds a role‑annotated transcript, asks OpenAI to summarize, and stores it by channel ID in `db/summaries.json`.
- `src/router.js`
  - Provides system + developer prompts, past chat context (`src/utils/getPastChats.js`), and the memory summary to OpenAI (`gpt-5-nano`).
  - The model either `respond`s directly or `forward`s to a larger model, handled by `responder`.
- `src/responder.js`
  - Runs the chosen model with tools:
    - `respond` → sends text/files to Discord via `sendMsgDiscord`.
    - `createPlugin` → builds a Paper plugin JAR; on success, adds it to `src/tools/storedFiles` and makes it available in `db/files.json`.
- `src/tools/sendMsgDiscord.js`
  - Splits long messages at newlines under 2000 chars; attaches files from `src/tools/storedFiles` if provided.

### GitHub Tools
- `src/tools/github.js` implements GitHub REST helpers using `GITHUB_TOKEN`.
- Tools exposed to the model (invoked via `responder`):
  - `github_list(owner, repo, path, ref?)` — list files/dirs.
  - `github_read(owner, repo, path, ref?)` — read a file’s text.
  - `github_write(owner, repo, path, content, message, branch, authorName?, authorEmail?)` — create/update a file.
  - `github_create_pr(owner, repo, head, base, title, body?)` — open a PR.
  - `github_create_repo({ org?, name, description?, isPrivate?, autoInit?, gitignoreTemplate?, licenseTemplate? })` — create a repo for the authenticated user or an org.
  - `github_add_collaborator(owner, repo, username, permission?)` — invite/add a collaborator.
  - `github_list_invitations()` — list pending repo invitations.
  - `github_accept_invitation(invitationId)` — accept a repo invitation.

## Plugin Builder (Paper 1.20.1)
The `createPlugin` tool compiles user‑provided code into a JAR using Maven:
- Inputs: Java source (main class in package `com.walrusmc`), `plugin.yml`, `config.yml`, `pluginVersion`, `pluginName`, optional Maven `<dependency>…</dependency>` blocks.
- Build: Generates a temporary Maven project targeting Java 17 and Paper API `1.20.1-R0.1-SNAPSHOT`.
- Output: Moves the built JAR to `src/tools/storedFiles/{pluginName}-{pluginVersion}.jar` and updates `db/files.json` so the bot can send it.
- Failure: Maven errors are captured and surfaced back to the model to retry/fix.

Ensure Java 17 and `mvn` are installed and on PATH for this to work.

## Data & Files
- `db/summaries.json` — per‑channel memory summary (overwritten per run for a channel).
- `db/files.json` — whitelist of files the bot can attach; includes built JARs.
- `src/tools/storedFiles` — attachment directory (ships with an example JAR and `placeholder.txt`).

## Permissions & Intents
- Add the bot to your guild with message content intent enabled.
- Populate `EVERY_ROLE_ID` with roles that may invoke Steve by mention.
- The bot ignores messages from other bots and `@everyone` mentions.

## Troubleshooting
- Bot doesn’t respond:
  - Check `TOKEN`, role IDs in `.env`, and whether the user mentioned the bot.
  - Verify MESSAGE CONTENT privileged intent is enabled in the Developer Portal and in the bot’s gateway options.
- OpenAI errors:
  - Set `OPENAI_API_KEY` and verify network access. Check logs if `logResponse` is enabled.
- Plugin builder fails:
  - Ensure Java 17 + Maven are installed; review the surfaced Maven error. Validate package name `com.walrusmc` and `plugin.yml`/`config.yml` syntax.
- Long messages cut off:
  - `sendMsgDiscord` splits on newlines under 2000 chars; include newlines in responses for cleaner splits.
- GitHub errors:
  - Verify `GITHUB_TOKEN` is set. For fine‑grained tokens, grant repo access and permissions: Contents: Read/Write, Pull requests: Read/Write. For classic tokens, include `repo` scope.
  - Ensure the branch exists for `github_write`.
  - Organization SSO: authorize the token for the org.

## Granting GitHub Access to Steve
- Recommended: create a dedicated GitHub account (e.g., `walrusmc-steve`) and generate a token for it.
- Add `GITHUB_TOKEN` for that account to `.env`.
- To let Steve create repos:
  - For user-owned repos: token needs classic `repo` scope (or fine‑grained with repository creation permission) and call `github_create_repo` without `org`.
  - For org repos: organization owners must grant the token permission to create repositories (fine‑grained token with Org access + “Administration/Content” as required), then call `github_create_repo` with `org`.
- To give Steve access to an existing repo:
  1. Invite Steve’s GitHub account as a collaborator in GitHub UI (or use `github_add_collaborator` from an owner token).
  2. Steve lists invites via `github_list_invitations` and accepts with `github_accept_invitation(invitationId)`.
  3. After acceptance, Steve can read/commit per granted permissions.

## Directory Overview
```
app.js
src/
  index.js
  router.js
  responder.js
  summarizer.js
  tools/
    sendMsgDiscord.js
    createPlugin.js
    storedFiles/
  utils/
    getPastChats.js
.db/
  summaries.json
  files.json
```

## License
ISC (see `package.json`).
