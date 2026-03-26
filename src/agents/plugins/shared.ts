import type { AgentInfo } from "../../types.js";
import type { PluginCreationRequest } from "./types.js";

export function buildPluginUserInput(info: AgentInfo) {
  const { message, pastChats } = info;
  const attachmentNames = message?.attachments?.size
    ? message.attachments.map(att => att.name ?? "UNKNOWN_ATTACHMENT")
    : [];

  // Every plugin specialist agent sees the same normalized Discord context.
  return JSON.stringify(
    {
      pastChats,
      currentUserMessage: {
        time: message.createdAt.toISOString(),
        author: {
          id: message.author.id,
          username: message.author.username,
          isAdministrator: true,
        },
        content: message.content,
        attachments: attachmentNames,
      },
    },
    null,
    2,
  );
}

export function buildPluginAssistantInput(
  request: PluginCreationRequest,
  extra: Record<string, unknown> = {},
) {
  // Agent-specific state is layered on top of the base plugin request so each
  // model call keeps a stable request shape plus only the extra context it needs.
  return JSON.stringify(
    {
      pluginRequest: request,
      ...extra,
    },
    null,
    2,
  );
}
