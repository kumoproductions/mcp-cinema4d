export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}
