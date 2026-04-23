# Agent: Complex

Source references:

- `src/router.ts`
- `src/index.ts`
- `src/types.ts`

## Role

`complex` is a planned responder tier, not an implemented agent.

The code treats it as the future home for:

- large workflows
- iterative code execution or debugging
- multiple coordinated server actions

## Current implementation status

There is no `src/agents/complex.ts`.

Instead:

- `ResponderResponse` allows `responder: "complex"`
- `src/router.ts` can choose the complex path
- `src/index.ts` can also force the complex path during clarification handling

In both places, the runtime currently replies with:

- `Placeholder for complex responder`

## Inputs

There is no real model call yet, so there are no real prompts or structured inputs.

The only concrete inputs are the pieces of state that decide whether the placeholder path is selected:

- routing flags from `classifier()`
- `clarifications[guildId]`

## What will likely belong here later

Based on the code comments and flag names, the intended scope appears to be:

- multi-step workflows
- iterative build/debug/test loops
- multi-server orchestration
- tasks too large for the current `moderate()` one-tool-at-a-time model

## Important note

Because this responder does not exist yet, any request that routes here gets a placeholder reply instead of real work.
