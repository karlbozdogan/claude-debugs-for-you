import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import { stackTrace } from "../utils/dap/stackTrace";
import { cleanStackFrames, formatStackFrames } from "../utils/stackTraceFormat";

const name = "getSessionState";
const description =
  "Get the state of the session, including a stack trace if the debuggee is stopped.";

const inputSchema = z.object({});

export async function handle(): Promise<string> {
  if (!vscode.debug.activeDebugSession) {
    return "No active debug session.";
  }

  // Neither DAP nor vscode has a mean of getting the current state of the
  // debuggee, so we have to make some assumptions here:
  // 1) That if the debuggee is stopped, a stack frame is selected (not
  // necessarily true - it might as well be a thread that it selected).
  // 2) If a stack frame is not selected but there is an active debug session,
  // the debuggee is running (most importantly, a thread might be selected
  // even if the debuggee is running).
  // 3) If a stack frame is selected, this is the stack frame of the thread
  // that stopped (not necessarily true - the user might have manually selected
  // another thread's stack frame).
  const stackItem = vscode.debug.activeStackItem;
  if (stackItem instanceof vscode.DebugStackFrame) {
    // Assume this is the stopped thread.
    const { session, threadId } = stackItem;

    const stack = await stackTrace(session, threadId);
    const trace = formatStackFrames(cleanStackFrames(stack.stackFrames));
    return `Stopped:\n${formatStackFrames(cleanStackFrames(stack.stackFrames))}`;
  }

  return "Running.";
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
