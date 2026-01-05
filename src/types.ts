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
// General Tools
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

// Google Docs
export type ReadDocSuccess = {
  size: number;
  documents: {
    title: string;
    id: string;
    link: string;
    tabs: DocTabs;
  }[]
};
export type DocTabs = {
  title: string;
  content: string;
  subTabs?: DocTabs;
}[];

export type ReadDocFail = {
  reason: "NO_DOCS" | "NO_AUTH" | "NOT_FOUND" | "FORBIDDEN" | "UNKNOWN";
  code: number;
};

// Plugins
export type PluginCodes = "CRASH" | "ALREADY_EXISTS" | "UNKOWN";
