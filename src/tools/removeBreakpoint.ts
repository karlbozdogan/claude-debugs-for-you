import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";

const name = "removeBreakpoint";
const description = "Remove breakpoints across all files at a given line.";

const inputSchema = z.object({
  line: z.coerce.number(),
});

export async function handle(payload: z.infer<typeof inputSchema>) {
  const bps = vscode.debug.breakpoints.filter((bp) => {
    if (bp instanceof vscode.SourceBreakpoint) {
      return bp.location.range.start.line === payload.line - 1;
    }
    return false;
  });
  if (bps.length === 0) {
    return `No breakpoint on line ${payload.line}`;
  }
  vscode.debug.removeBreakpoints(bps);
  return "Success.";
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
