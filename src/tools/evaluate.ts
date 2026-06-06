import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import { DebugSessionRegistry } from "./debugSessionRegistry";

const name = "evaluate";
const description = "Evaluate a given expression at a given stack frame.";

const inputSchema = z.object({
  expression: z.string(),
  frameId: z.coerce.number(),
});

export async function handle(debugSessionRegistry: DebugSessionRegistry, payload: z.infer<typeof inputSchema>) {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    return "No active debug session.";
  }

  try {
    const response = await session.customRequest("evaluate", {
      expression: payload.expression,
      frameId: payload.frameId,
      context: "watch",
    });

    return `Eval result: ${JSON.stringify(response)}`;
  } catch (err: any) {
    let errorMessage = "";
    let stackTrace = "";

    if (err instanceof Error) {
      errorMessage = err.message;
      if (err.stack) {
        stackTrace = `\nStack: ${err.stack}`;
      }
    } else {
      errorMessage = String(err);
    }
    return `Eval failed: ${errorMessage}${stackTrace}`;
  }
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
