import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import { stackTrace } from "../utils/dap/stackTrace";
import { formatStackFrames, cleanStackFrames } from "../utils/stackTraceFormat";
import { logger } from "../logger";
import { DebugSessionRegistry } from "./debugSessionRegistry";

const name = "wait";
const description =
  "Block until a breakpoint gets hit or the debuggee exits. Times out after 15 seconds. Returns the stack trace of the stopped thread.";

const inputSchema = z.object({});

// Source - https://stackoverflow.com/a/46675277
// Posted by Drew Noakes, modified by community. See post 'Timeline' for change history
// Retrieved 2026-03-28, License - CC BY-SA 4.0
async function withTimeout<T>(
  millis: number,
  callback: () => Error,
  promise: Promise<T>,
): Promise<T> {
  let timeout!: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>(
    (_, reject) => (timeout = setTimeout(() => reject(callback()), millis)),
  );
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForStackFrame(debugSessionRegistry: DebugSessionRegistry) {
  if (debugSessionRegistry.getSessions().size === 0) {
    throw Error("No active debug session.");
  }

  const stackItem = vscode.debug.activeStackItem;
  if (stackItem instanceof vscode.DebugStackFrame) {
    return stackItem;
  }

  let handle: vscode.Disposable;
  const sfPromise = new Promise<{
    session: vscode.DebugSession;
    threadId: number;
  }>((res, rej) => {
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
    handle = vscode.debug.onDidChangeActiveStackItem((stackItem) => {
      if (stackItem instanceof vscode.DebugStackFrame) {
        res(stackItem);
      } else if (!stackItem) {
        rej("The debug session has exited.");
      }
    });
  });
  return withTimeout(
    15000,
    () => Error("No breakpoint was hit after 15 seconds. Timing out."),
    sfPromise,
  ).finally(() => handle?.dispose());
}

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
): Promise<string> {
  const frame = await waitForStackFrame(debugSessionRegistry);
  const { session, threadId } = frame;

  const stack = await stackTrace(session, threadId);
  return `Stopped:\n${formatStackFrames(cleanStackFrames(stack.stackFrames))}`;
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
