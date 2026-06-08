import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import * as GetSessionsState from "./getSessionStates";
import { DebugSessionRegistry } from "../debugSessionRegistry";
import { sleep } from "../utils/sleep";

const name = "removeBreakpoint";
const description = "Remove a breakpoint.";

const inputSchema = z.object({
  sessionId: z.string().optional(),
  file: z.string(),
  line: z.coerce.number(),
});

export async function handle(
  debugSessionRegisty: DebugSessionRegistry,
  payload: z.infer<typeof inputSchema>,
) {
  // Open the file and make it active
  const document = await vscode.workspace.openTextDocument(payload.file);
  const editor = await vscode.window.showTextDocument(document);
  const targetUri = editor.document.uri.toString();

  let closestLine: number | undefined;

  // Try un-resolving the line.
  const sourceBreakpoint = debugSessionRegisty.getSessionOrTheStopped(payload.sessionId)?.breakpoints?.get(payload.file)?.find((b) => b.line === payload.line);
  // Adjust the line in the payload if we could.
  if (sourceBreakpoint) {
    payload.line = sourceBreakpoint.requestedLine;
  }


  const breakpoint = vscode.debug.breakpoints.find((bp) => {
    if (
      !(bp instanceof vscode.SourceBreakpoint) ||
      bp.location.uri.toString() !== targetUri
    ) {
      return false;
    }
    if (bp.location.range.start.line+1 === payload.line) {
      return true;
    }

    const breakpointLine = bp.location.range.start.line+1;
    closestLine =
      typeof closestLine === "undefined"
        ? breakpointLine
        : Math.abs(closestLine - payload.line) <
            Math.abs(breakpointLine - payload.line)
          ? closestLine
          : breakpointLine;

    return false;
  });
  if (!breakpoint) {
    return `Breakpoint not found.${typeof closestLine !== "undefined" ? ` The closest breakpoint is at line ${closestLine}.` : ""}`;
  }
  vscode.debug.removeBreakpoints([breakpoint]);

  await sleep(1000);
  return GetSessionsState.handle(debugSessionRegisty);
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
