import OpenAI from "openai";
import { models } from "../models.js";
import { AgentInfo } from "../types.js";

const client = new OpenAI();

export async function classifier(info: AgentInfo) {
  const { message } = info;
  const { pastChats } = info;

  // currentUserMessage
  const attachmentNames = message?.attachments?.size 
  ? message.attachments.map(att => att.name ?? "UNKNOWN_ATTACHMENT")
  : [];
  const currentUserMessage = {
    time: message.createdAt.toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      isAdministrator: true
    },
    content: message.content,
    attachments: attachmentNames
  };

  // Send request to OpenAI
  const response = await client.responses.create({
    "model": models.general.low.fast,
    "input": [
      {
        "role": "system",
        "content": "You are a classifier that classifies the currentUserMessage. Only return JSON. No explanation."
      },
      {
        "role": "user",
        "content": JSON.stringify({
          pastChats: pastChats,
          currentUserMessage: currentUserMessage
        })
      }
    ],
    "text": {
      "format": {
        "type": "json_schema",
        "name": "routing_flags",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {
            "needs_plugin_work": { "type": "boolean" },
            "needs_server_action": { "type": "boolean" },
            "needs_recent_data": { "type": "boolean" },
            "needs_structured_planning": { "type": "boolean" },
            "needs_to_browse_web": { "type": "boolean" },
            "needs_document_access": { "type": "boolean" },


            "needs_multiple_server_actions": { 
              "type": "boolean",
              "description": "The server refers to a remote Minecraft server and some server actions include: start/stop server, file interaction, and command execution."
             },
            "needs_iterative_code_execution_or_debugging": { "type": "boolean" },
            "needs_large_workflow": { "type": "boolean" }
          },
          "required": [
            "needs_plugin_work",
            "needs_server_action",
            "needs_recent_data",
            "needs_structured_planning",
            "needs_to_browse_web",
            "needs_document_access",
            "needs_multiple_server_actions",
            "needs_iterative_code_execution_or_debugging",
            "needs_large_workflow"
          ],
          "additionalProperties": false
        }
      }
    },
    "temperature": 0,
    "max_output_tokens": 100
  });

  return JSON.parse(response.output_text);
}
