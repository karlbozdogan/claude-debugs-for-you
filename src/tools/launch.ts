import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";

const name = "launch";
const description = "Start the debug session.";

const inputSchema = z.object({});

export async function handle(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("No workspace folder found");
  }

  // Return an error message if we are already debugging
  if (vscode.debug.activeDebugSession) {
    return "Already debugging.";
  }

  // Start debugging using the well-known launch configuration
  await vscode.debug.startDebugging(workspaceFolder, "claude_debug");

  return `Launched.`;
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
