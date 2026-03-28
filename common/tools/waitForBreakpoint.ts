import { z } from "zod";
import { ToolConfig } from "./types";

const name = "waitForBreakpoint";
const description =
  "Block until a breakpoint gets hit or the debuggee exits. Returns the stack trace.";

const inputSchema = z.object({});

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
