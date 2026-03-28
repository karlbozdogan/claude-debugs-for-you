import * as http from "http";
import * as vscode from "vscode";
import { EventEmitter } from "events";
import * as cont from "../common/tools/continue";
import * as variables from "../common/tools/variables";
import * as evaluate from "../common/tools/evaluate";
import * as launch from "../common/tools/launch";
import * as stop from "../common/tools/stop";
import * as removeBreakpoint from "../common/tools/removeBreakpoint";
import * as setBreakpoint from "../common/tools/setBreakpoint";
import * as waitForBreakpoint from "../common/tools/waitForBreakpoint";
import {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import {
  AnySchema,
  SchemaOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolConfig } from "../common/tools/types";
import { logger } from "./logger";

interface DebugServerEvents {
  on(event: "started", listener: () => void): this;
  on(event: "stopped", listener: () => void): this;
  emit(event: "started"): boolean;
  emit(event: "stopped"): boolean;
}

export class DebugServer extends EventEmitter implements DebugServerEvents {
  private port: number = 4711;
  private server: http.Server | null = null;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private app: express.Express;

  constructor(port?: number) {
    super();
    this.port = port || 4711;

    this.app = express();
    this.app.use(express.json());

    this.app.post("/mcp", async (req, res) => {
      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        // Reuse existing transport
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            this.transports[sessionId] = transport;
          },
          allowedHosts: ["127.0.0.1", "localhost"],
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.transports[transport.sessionId];
          }
        };

        const server = new McpServer({
          name: "mcp-debug-server",
          version: "1.0.0",
        });

        this.addTools(server);

        // Connect to the MCP server
        await server.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });
  }

  setPort(port: number): void {
    this.port = port || 4711;
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          this.server = server;
          this.emit("started");
          resolve();
        }
      });
    });
  }

  private addTools(server: McpServer) {
    function registerToolWrapper<Input extends AnySchema>(
      config: ToolConfig<Input>,
      tool: (input: SchemaOutput<Input>) => Promise<string>,
    ) {
      const toolWrapped = (async (
        input: SchemaOutput<Input>,
        extra: unknown,
      ) => {
        logger.info(
          `<-- Tool call  : ${config.name}: ${JSON.stringify(input)}`,
        );
        try {
          const res = await tool(input);
          logger.info(`--> Tool result: ${config.name}: ${res}`);
          return {
            content: [{ type: "text" as const, text: res }],
          } satisfies CallToolResult;
        } catch (e) {
          const res = `Error: ${e}`;
          logger.info(`--> Tool error : ${config.name}: ${res}`);
          return {
            content: [{ type: "text" as const, text: res }],
            isError: true,
          } satisfies CallToolResult;
        }
      }) satisfies ToolCallback<any> as any;
      server.registerTool(config.name, config, toolWrapped);
    }

    registerToolWrapper(setBreakpoint.tool, handleSetBreakpoint);
    registerToolWrapper(removeBreakpoint.tool, handleRemoveBreakpoint);
    registerToolWrapper(variables.tool, handleVariables);
    registerToolWrapper(evaluate.tool, handleEvaluate);
    registerToolWrapper(launch.tool, handleLaunch);
    registerToolWrapper(stop.tool, handleStop);
    registerToolWrapper(cont.tool, handleContinue);
    registerToolWrapper(waitForBreakpoint.tool, handleWaitForBreakpoint);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        this.emit("stopped");
        resolve();
      });
    });
  }
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

async function handleLaunch(): Promise<string> {
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

async function handleStop(): Promise<string> {
  await vscode.debug.stopDebugging();

  return `Stopped debugging.`;
}

async function handleWaitForBreakpoint(): Promise<string> {
  const frame = await waitForStackFrame();
  if (!frame) {
    return "Debuggee has exited.";
  }
  const { session, threadId } = frame;

  const stack = await session.customRequest("stackTrace", { threadId });
  return `Stopped:\n${formatStackFrames(cleanStackFrames(stack.stackFrames))}`;
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

  let handle!: vscode.Disposable;
  const res = await new Promise<vscode.DebugStackFrame | undefined>((res) => {
    handle = vscode.debug.onDidChangeActiveStackItem((stackItem) => {
      if (stackItem instanceof vscode.DebugStackFrame) {
        res(stackItem);
      }
      if (typeof stackItem === "undefined") {
        res(undefined);
      }
    });
  });
  handle.dispose();
  return res;
}

async function handleContinue() {
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

async function handleSetBreakpoint(
  payload: z.infer<typeof setBreakpoint.tool.inputSchema>,
) {
  // Open the file and make it active
  const document = await vscode.workspace.openTextDocument(payload.file);
  const editor = await vscode.window.showTextDocument(document);

  const bp = new vscode.SourceBreakpoint(
    new vscode.Location(
      editor.document.uri,
      new vscode.Position(payload.line - 1, 0),
    ),
    true,
    payload.condition,
  );
  vscode.debug.addBreakpoints([bp]);
  return "Success.";
}

async function handleRemoveBreakpoint(
  payload: z.infer<typeof removeBreakpoint.tool.inputSchema>,
) {
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

async function handleVariables(
  payload: z.infer<typeof variables.tool.inputSchema>,
) {
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    return "No active debug session.";
  }

  const response = await session.customRequest("variables", {
    variablesReference: payload.variablesReference,
  });

  return `Variables result: ${JSON.stringify(response)}`;
}

async function handleEvaluate(
  payload: z.infer<typeof evaluate.tool.inputSchema>,
) {
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
