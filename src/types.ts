import type { Message, Snowflake } from "discord.js";


/** MISC **/
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

export type AgentInfo = {
  guildId: string
  message: Message;
  pastChats: PastChats;
  //summary: string;
};

export type ResponderResponse = {
  messages: Message<boolean>[] | false;
  isClarification: boolean;
  responder: "nano" | "moderate" | "complex";
};

/** TOOLS **/
export type ToolSuccess<T> = {
  success: true;
  result: T;
};

export type ToolError<E> = {
  success: false;
  error: E;
};

export type ToolResult<T, E> = {
  name: string;
} & (ToolSuccess<T> | ToolError<E>);
