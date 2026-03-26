import * as net from "net";
import * as http from "http";
import * as vscode from "vscode";
import { EventEmitter } from "events";
import * as cont from "../common/tools/continue";
import * as variables from "../common/tools/variables";
import * as evaluate from "../common/tools/evaluate";
import * as launch from "../common/tools/launch";
import * as removeBreakpoint from "../common/tools/removeBreakpoint";
import * as setBreakpoint from "../common/tools/setBreakpoint";
import { tools } from "../common/tools/tools";
import { z } from "zod";

interface DebugServerEvents {
  on(event: "started", listener: () => void): this;
  on(event: "stopped", listener: () => void): this;
  emit(event: "started"): boolean;
  emit(event: "stopped"): boolean;
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export interface DebugCommand {
  command: "debug";
  payload: any;
}

export interface DebugStep {
  type:
    | "setBreakpoint"
    | "removeBreakpoint"
    | "continue"
    | "evaluate"
    | "launch";
  file: string;
  line?: number;
  expression?: string;
  condition?: string;
}

interface ToolRequest {
  type: "listTools" | "callTool";
  tool?: string;
  arguments?: any;
}

export class DebugServer extends EventEmitter implements DebugServerEvents {
  private server: net.Server | null = null;
  private port: number = 4711;
  private portConfigPath: string | null = null;
  private activeTransports: Record<string, SSEServerTransport> = {};
  private mcpServer: McpServer;
  private _isRunning: boolean = false;

  constructor(port?: number, portConfigPath?: string) {
    super();
    this.port = port || 4711;
    this.portConfigPath = portConfigPath || null;
    this.mcpServer = new McpServer({
      name: "Debug Server",
      version: "1.0.0",
    });

    // Setup MCP tools to use our existing handlers
    // this.mcpServer.registerTool(cont.tool.name, cont.tool, async () => {
    //   return this.handleContinue();
    // });
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  setPort(port: number): void {
    this.port = port || 4711;

    // Update port in configuration file if available
    if (this.portConfigPath && typeof port === "number") {
      try {
        const fs = require("fs");
        fs.writeFileSync(this.portConfigPath, JSON.stringify({ port }));
      } catch (err) {
        console.error("Failed to update port configuration file:", err);
        // We'll still use the new port even if saving to file fails
      }
    }
  }

  getPort(): number {
    return this.port;
  }

  async forceStopExistingServer(): Promise<void> {
    try {
      // Send a request to the shutdown endpoint of any existing server
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "localhost",
            port: this.port,
            path: "/shutdown",
            method: "POST",
            timeout: 3000, // 3 second timeout
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              if (res.statusCode === 200) {
                // Give the server a moment to shut down
                setTimeout(resolve, 500);
              } else {
                reject(new Error(`Unexpected status: ${res.statusCode}`));
              }
            });
          },
        );

        req.on("error", (err: NodeJS.ErrnoException) => {
          // If we can't connect, there's no server running or it's not ours
          if (err.code === "ECONNREFUSED") {
            resolve(); // No server running, so nothing to stop
          } else {
            reject(err);
          }
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timed out"));
        });

        req.end();
      });
    } catch (err) {
      console.error("Error requesting server shutdown:", err);
      throw new Error("Failed to stop existing server");
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      throw new Error("Server is already running");
    }

    this.server = http.createServer(async (req, res) => {
      // Handle CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }

      // Shutdown endpoint - allows another instance to request shutdown of this server
      if (req.method === "POST" && req.url === "/shutdown") {
        res.writeHead(200).end("Server shutting down");
        this.stop().catch((err) => {
          res.writeHead(500).end(`Error shutting down: ${err.message}`);
        });
        return;
      }

      // Legacy TCP-style endpoint
      if (req.method === "POST" && req.url === "/tcp") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const request = JSON.parse(body);
            let response: any;

            if (request.type === "listTools") {
              response = { tools };
            } else if (request.type === "callTool") {
              response = await this.handleCommand(request);
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: response }));
          } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          }
        });
        return;
      }

      // SSE endpoint
      if (req.method === "GET" && req.url === "/sse") {
        const transport = new SSEServerTransport("/messages", res);
        this.activeTransports[transport.sessionId] = transport;
        await this.mcpServer.connect(transport);
        res.on("close", () => {
          delete this.activeTransports[transport.sessionId];
        });
        return;
      }

      // Message endpoint for SSE
      if (req.method === "POST" && req.url?.startsWith("/messages")) {
        const url = new URL(req.url, "http://localhost");
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId || !this.activeTransports[sessionId]) {
          res.writeHead(404).end("Session not found");
          return;
        }
        await this.activeTransports[sessionId].handlePostMessage(req, res);
        return;
      }

      res.writeHead(404).end();
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => {
        this._isRunning = true;
        this.emit("started");
        resolve();
      }).on("error", reject);
    });
  }

  // Helper method to handle tool calls
  private async handleCommand(request: ToolRequest): Promise<string> {
    switch (request.tool) {
      case "setBreakpoint":
        return this.handleSetBreakpoint(
          setBreakpoint.tool.inputSchema.parse(request.arguments),
        );
      case "removeBreakpoint":
        return this.handleRemoveBreakpoint(
          removeBreakpoint.tool.inputSchema.parse(request.arguments),
        );
      case "variables":
        return this.handleVariables(
          variables.tool.inputSchema.parse(request.arguments),
        );
      case "evaluate":
        return this.handleEvaluate(
          evaluate.tool.inputSchema.parse(request.arguments),
        );
      case "launch":
        return this.handleLaunch();
      case "continue":
        return await this.handleContinue();
      default:
        throw new Error(`Unknown tool: ${request.tool}`);
    }
  }

  private static cleanStackFrames(stackFrames_: any) {
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

  private static formatStackFrames(
    stackFrames: ReturnType<typeof DebugServer.cleanStackFrames>,
  ): string {
    // Collapse internal frames
    const res = stackFrames.reduce(
      ({ internalFramesCounter, acc }, frame) => {
        if (frame.presentationHint === "subtle") {
          return { internalFramesCounter: internalFramesCounter+1, acc };
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

  private async handleLaunch(): Promise<string> {
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

    // Wait for a breakpoint to be hit
    const frame = await this.waitForStackFrame();
    if (!frame) {
      return "Debuggee has exited.";
    }
    const { session, threadId } = frame;

    const stack = await session.customRequest("stackTrace", { threadId });
    return `Launched successfully. Stopped:\n${DebugServer.formatStackFrames(DebugServer.cleanStackFrames(stack.stackFrames))}`;
  }

  private async waitForStackFrame(): Promise<
    vscode.DebugStackFrame | undefined
  > {
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

  private async handleContinue() {
    let session = vscode.debug.activeDebugSession;
    if (!session) {
      throw new Error("No active debug session");
    }

    // Get the current thread ID (required by DAP spec)
    const threads = await session.customRequest("threads");
    let threadId = threads.threads[0].id;

    // Continue with the thread ID
    await session.customRequest("continue", { threadId });

    // Wait for a breakpoint to be hit
    const frame = await this.waitForStackFrame();
    if (!frame) {
      return "Debuggee has exited.";
    }
    ({ session, threadId } = frame);

    const stack = await session.customRequest("stackTrace", { threadId });
    return `Continued successfully. Stopped:\n${DebugServer.formatStackFrames(DebugServer.cleanStackFrames(stack.stackFrames))}`;
  }

  private async handleSetBreakpoint(
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

  private async handleRemoveBreakpoint(
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

  private async handleVariables(
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

  private async handleEvaluate(
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

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        this._isRunning = false;
        this.emit("stopped");
        resolve();
        return;
      }

      Object.values(this.activeTransports).forEach((transport) => {
        transport.close();
      });
      this.activeTransports = {};

      this.server.close(() => {
        this.server = null;
        this._isRunning = false;
        this.emit("stopped");
        resolve();
      });
    });
  }
}
