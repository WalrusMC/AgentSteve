# Agent: Classifier

Source: `src/agents/classifier.ts`

## Role

The classifier is the first OpenAI agent in the normal Discord routing path. Its only job is to inspect the current message plus recent chat context and emit routing flags.

`src/router.ts` uses those flags to decide between:

- `nano`
- `moderate`
- the placeholder `complex` responder

## Model

- `models.general.low.fast`
- currently `gpt-4.1-mini`

## Inputs

| Input | Included? | Details |
| --- | --- | --- |
| System prompt | Yes | Static classifier instructions. |
| Developer prompt | No | This agent does not use a developer-role message. |
| User prompt | Yes | JSON containing `pastChats` and `currentUserMessage`. |
| Assistant prompt | No | None. |
| Past chats | Yes | `info.pastChats`. |
| Current user message | Yes | Time, author, content, attachments. |
| Plugin/code/project files | No | The classifier never sees code. |
| Tool history | No | None. |
| Resource inventory | No | No downloads, plugins, or server state. |

## Output

The classifier returns strict JSON with these booleans:

- `needs_plugin_work`
- `needs_server_action`
- `needs_recent_data`
- `needs_structured_planning`
- `needs_to_browse_web`
- `needs_document_access`
- `needs_multiple_server_actions`
- `needs_iterative_code_execution_or_debugging`
- `needs_large_workflow`

## How it is used

`src/router.ts` logs the flags and then:

- sends some requests to the placeholder `complex` path
- sends any flagged non-complex request to `moderate()`
- sends fully unflagged requests to `nano()`

## Important note

There is currently a schema/consumer mismatch:

- classifier output: `needs_iterative_code_execution_or_debugging`
- router check: `needs_code_execution_or_debugging_or_testing`

So one intended complex-routing signal is currently ignored by the router.
