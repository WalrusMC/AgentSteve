import type { Message, Snowflake } from "discord.js";

export type CustomMessage = {
  time: string;
  author: {
    id: Snowflake;
    username: string;
    isAdministrator: boolean;
  };
  content: string;
  attachments: string[];
};

export type PastChats = CustomMessage[];

export type ToolResult = {
  name: string;
  success: boolean;
  result: unknown;
  code: number;
  metaData?: unknown;
};

export type AgentInfo = {
  message: Message;
  pastChats: PastChats;
  //summary: string;
};

export type ResponderResponse = {
  messages: Message<boolean>[] | false,
  isClarification: boolean,
  responder: "nano" | "moderate" | "complex"
}