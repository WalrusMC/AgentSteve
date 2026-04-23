# Workflow: Plugin Creation

This file describes the end-to-end path for a new plugin request.

## 1. User request enters `moderate()`

The top-level user-facing plugin flow starts in `src/agents/moderate.ts`.

The model can call `createNewPlugin` with:

- `pluginName`
- `assistantMessage.intent`
- `assistantMessage.summary`
- `assistantMessage.requirements[]`

That payload becomes `PluginCreationRequest`.

## 2. The plugin pipeline starts

`src/pipelines/plugin.ts:createNewPlugin()` is the orchestration entrypoint.

It:

1. rejects duplicate names through `plugin.exists()`
2. classifies complexity through the plugin router
3. builds an in-memory project manifest
4. compiles the manifest into a JAR
5. reviews the finished plugin
6. stores the final plugin record

## 3. Complexity decides the workflow

### Simple plugin

- Skip architecture planning.
- Call `coder.createNew()`.
- Expect one full manifest.

### Medium plugin

- Call `architect()` for sequential tasks.
- Feed the first task into `coder.createNew()`.
- Feed each later task into `coder.editExisting()`.
- Apply each returned `PluginEditPlan` to the current manifest.

### Large plugin

- Immediately return `LARGE_UNSUPPORTED`.

## 4. Manifest generation details

The coders do not work with raw filesystem state. They work with structured JSON.

For a new-project generation pass, the coder sees:

- the original Discord user context
- the normalized plugin request
- workflow mode (`simple` or `medium`)
- possibly the current task and remaining tasks

For an edit pass, the coder also sees:

- completed tasks
- remaining tasks
- the full current project as line-numbered files
- the current dependency and repository arrays

## 5. Local patch application

For medium tasks, the pipeline applies the patch plan itself.

The sequence is:

1. delete requested line ranges from matching files
2. insert new content into matching files
3. append new Java files
4. append new resource files
5. replace the manifest dependency and repository arrays

This happens entirely in TypeScript before any build starts.

## 6. Build loop

`src/tools/plugin.ts:buildNew()` performs the build.

It:

- validates required files
- writes a temporary Maven project
- renders `pom.xml`
- runs `mvn clean package`
- moves the resulting JAR into the guild downloads folder
- creates or updates the corresponding `Download` row
- persists the source tree to GitHub

If compilation fails with `BUILD_FAILED`, the pipeline calls `coder.fixBuildError()` with:

- the plugin request
- the current project
- the raw build error text

Then it retries the build. The maximum number of repair attempts is `2`.

## 7. Review and summary

After a successful build, `reviewer()` produces:

- `summary`
- `commands[]`
- `permissions[]`
- `notes[]`

The pipeline turns that into a single stored summary string. If reviewer output is invalid, the pipeline falls back to:

- `project.description`
- or the original assistant summary

## 8. Persistence outputs

A successful run leaves four kinds of output behind:

### Prisma

- one `Plugin` row
- one `Download` row for the JAR

### Filesystem

- `src/tools/downloads/<guildId>/<pluginName>-<version>.jar`

### GitHub

- a private repo named `<guildId>-<pluginName>` under `agent-steve-official`

### Discord

- a `moderate()` reply that can attach the JAR file

## 9. Failure points to know about

- Duplicate plugin name -> `ALREADY_EXISTS`
- Large plugin -> `LARGE_UNSUPPORTED`
- Invalid architect/coder/reviewer response -> `INTERNAL_ERROR` wrappers
- Build failure after retries -> `BUILD_FAILED`
- GitHub source persistence failure -> currently surfaced as a failed build result even if the JAR exists

## 10. Why this subsystem matters

The plugin pipeline is the clearest example of AgentSteve's intended architecture:

- small specialized agents
- deterministic orchestration in TypeScript
- structured intermediate state
- local validation and repair loops
- external side effects only after the project is coherent enough to build
