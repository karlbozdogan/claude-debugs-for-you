import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";

const name = "waitForBreakpoint";
const description =
  "Block until a breakpoint gets hit or the debuggee exits. Returns the stack trace.";

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

async function waitForStackFrame(): Promise<
  vscode.DebugStackFrame | undefined
> {
  if (!vscode.debug.activeDebugSession) {
    return undefined;
  }

  const stackItem = vscode.debug.activeStackItem;
  if (stackItem instanceof vscode.DebugStackFrame) {
    return stackItem;
  }

  let handle: vscode.Disposable;
  const sfPromise = new Promise<vscode.DebugStackFrame | undefined>((res) => {
    handle = vscode.debug.onDidChangeActiveStackItem((stackItem) => {
      if (stackItem instanceof vscode.DebugStackFrame) {
        res(stackItem);
      }
      if (typeof stackItem === "undefined") {
        res(undefined);
      }
    });
  });
  return withTimeout(
    15000,
    () => Error("No breakpoint was hit after 15 seconds. Timing out."),
    sfPromise,
  ).finally(() => handle?.dispose());
}

function cleanStackFrames(stackFrames_: any) {
  const stackFramesSchema = z.array(
    z.object({
      line: z.number(),
      source: z
        .object({
          name: z.string().optional(),
          path: z.string().optional(),
        })
        .loose()
        .optional(),
      id: z.number(),
      name: z.string(),
      column: z.number(),
      presentationHint: z.string().optional(),
    }),
  );

  const stackFrames = stackFramesSchema.parse(stackFrames_);

  const stackFramesTransformed = stackFrames.map((frame) => {
    if (!frame.source?.path) {
      return frame;
    }
    let pathURL;
    try {
      pathURL = new URL(frame.source.path);
    } catch (e) {
      return frame;
    }
    return {
      ...frame,
      source: {
        ...frame.source,
        path:
          pathURL.protocol === "vscode-remote:"
            ? pathURL.pathname
            : pathURL.toString(),
      },
    };
  });

  return stackFramesTransformed;
}

function formatStackFrames(
  stackFrames: ReturnType<typeof cleanStackFrames>,
): string {
  // Collapse internal frames
  const res = stackFrames.reduce(
    ({ internalFramesCounter, acc }, frame) => {
      if (frame.presentationHint === "subtle") {
        return { internalFramesCounter: internalFramesCounter + 1, acc };
      } else {
        return {
          internalFramesCounter: 0,
          acc: `${acc}${internalFramesCounter > 0 ? `... (${internalFramesCounter} internal frames)\n` : ""}${JSON.stringify(frame)}\n`,
        };
      }
    },
    { internalFramesCounter: 0, acc: "" },
  );
  // Handle trailing internal frames
  return (
    res.acc +
    (res.internalFramesCounter > 0
      ? `... (${res.internalFramesCounter} internal frames)\n`
      : "")
  );
}

export async function handle(): Promise<string> {
  const frame = await waitForStackFrame();
  if (!frame) {
    return "Debuggee has exited.";
  }
  const { session, threadId } = frame;

  const stack = await session.customRequest("stackTrace", { threadId });
  return `Stopped:\n${formatStackFrames(cleanStackFrames(stack.stackFrames))}`;
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
