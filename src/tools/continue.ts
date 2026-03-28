import { z } from 'zod';
import * as vscode from "vscode";
import { ToolConfig } from './types';

const name = "continue";
const description = "Continue execution from a breakpoint.";

const inputSchema = z.object({});

export async function handle() {
  let session = vscode.debug.activeDebugSession;
  if (!session) {
    throw new Error("No active debug session");
  }

  // Get the current thread ID (required by DAP spec)
  const threads = await session.customRequest("threads");
  let threadId = threads.threads[0].id;

  // Continue with the thread ID
  await session.customRequest("continue", { threadId });

  return `Continued.`;
}


export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;