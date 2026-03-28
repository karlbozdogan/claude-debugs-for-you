import { z } from "zod";
import * as vscode from "vscode";

const name = "variables";
const description =
  "Retrieves all child variables for the given variable reference.";

const inputSchema = z.object({
  // Claude sometimes passes numbers as strings by mistake
  variablesReference: z.coerce.number(),
});

export async function handle(payload: z.infer<typeof inputSchema>) {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    return "No active debug session.";
  }

  const response = await session.customRequest("variables", {
    variablesReference: payload.variablesReference,
  });

  return `Variables result: ${JSON.stringify(response)}`;
}

export const tool = { name, description, inputSchema };
