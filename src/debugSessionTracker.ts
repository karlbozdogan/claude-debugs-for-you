import * as vscode from "vscode";
import { z } from "zod";

import * as dap from "./dap";
import { logger } from "./logger";
import { BreakpointEventSchema } from "./dap/events/breakpoint_event";
import { ContinuedSchema } from "./dap/events/continued";
import { ExitedSchema } from "./dap/events/exited";
import { StoppedSchema } from "./dap/events/stopped";

export type InitializingState = { type: "initializing" };
export type RunningState = { type: "running" };
export type StoppedState = { type: "stopped"; threadId: number };
export type ExitedState = { type: "exited" };

export type Breakpoint = dap.Breakpoint & { line: number; condition?: string };

export interface DebugSessionState {
  readonly session: vscode.DebugSession;
  readonly state: Readonly<
    InitializingState | RunningState | StoppedState | ExitedState
  >;
  // Keyed by source path ?? name.
  breakpoints: ReadonlyMap<string, readonly Breakpoint[]>;
}

export class DebugSessionStateImpl implements DebugSessionState {
  readonly session: vscode.DebugSession;
  state: DebugSessionState["state"] = { type: "initializing" };
  breakpoints: Map<string, Breakpoint[]>;
  // This only contains setBreakpoints requests that have not
  // received a response from the adapter yet.
  pending_setbreakpoints_requests: Map<number, dap.SetBreakpointsArguments>;

  constructor(session: vscode.DebugSession) {
    this.session = session;
    this.breakpoints = new Map();
    this.pending_setbreakpoints_requests = new Map();
  }
}

const setBreakpointsRequestSchema = z.object({
  seq: z.int(),
  command: z.literal("setBreakpoints"),
  arguments: dap.SetBreakpointsArgumentsSchema,
});

const setBreakpointsResponseSchema = z.object({
  request_seq: z.int(),
  body: z.object({
    breakpoints: z.array(dap.BreakpointSchema),
  }),
});

type SetBreakpointsResponse = z.infer<typeof setBreakpointsResponseSchema>;

const eventSchema = z.discriminatedUnion("event", [
  BreakpointEventSchema,
  ContinuedSchema,
  ExitedSchema,
  StoppedSchema,
]);

type Event = z.infer<typeof eventSchema>;

export class DebugSessionTracker {
  state: DebugSessionStateImpl;
  delState: () => void;
  fireStateChanged: () => void;

  constructor(
    state: DebugSessionStateImpl,
    delState: () => void,
    fireStateChanged: () => void,
  ) {
    this.state = state;
    this.delState = delState;
    this.fireStateChanged = fireStateChanged;
  }

  onWillReceiveMessage(msg: any) {
    logger.debug("Editor sending DAP message", this.state.session.id, msg);
    try {
      const parsed = setBreakpointsRequestSchema.safeParse(msg);
      if (!parsed.success) {
        return;
      }
      const data = parsed.data;
      this.state.pending_setbreakpoints_requests.set(data.seq, data.arguments);
    } catch (e) {
      logger.error("Caught exception while handling DAP message", e);
    }
  }

  handleBreakpointEvent(event: dap.BreakpointEvent["body"]) {
    switch (event.reason) {
      case "new":
        // We do not support "new" breakpoint events.
        break;
      case "changed":
        const id = event.breakpoint.id;
        if (typeof id === "undefined") {
          // As per the DAP spec.
          logger.warn("Expected id in breakpoint changed event.");
        }
        // Naively search for the matching id across all the sources.
        // This can be improved for sure.
        (() => {
          for (const breakpoints of this.state.breakpoints.values()) {
            for (let i = 0; i < breakpoints.length; i++) {
              if (breakpoints[i].id === id) {
                breakpoints[i] = { ...breakpoints[i], ...event.breakpoint };
                this.fireStateChanged();
                return;
              }
            }
          }
          logger.warn("Did not find a matching breakpoint.");
        })();
        break;
      case "removed":
        // We do not support "removed" breakpoint events.
        break;
      default:
        event.reason satisfies never;
    }
  }

  handleDAPEvent(event: Event) {
    logger.debug("Got DAP event", this.state.session.id, event);
    switch (event.event) {
      case "continued":
        this.state.state = { type: "running" };
        break;
      case "exited":
        this.state.state = { type: "exited" };
        break;
      case "stopped":
        this.state.state = { type: "stopped", threadId: event.body.threadId };
        break;
      case "breakpoint":
        this.handleBreakpointEvent(event.body);
        break;
      default:
        event satisfies never;
    }
    this.fireStateChanged();
  }

  handleSetBreakpointsResponse(response: SetBreakpointsResponse) {
    const request = this.state.pending_setbreakpoints_requests.get(
      response.request_seq,
    );
    if (!request) {
      // No corresponding request.
      // Maybe this is not even a setBreakpoints request, after all.
      // In any case, not much we can do.
      return;
    }
    // Remove the request from the buffer.
    this.state.pending_setbreakpoints_requests.delete(response.request_seq);

    // Need to merge the request and the response, because the response
    // may omit line information and does not have conditions.
    const requestBreakpoints = request.breakpoints;
    if (!requestBreakpoints) {
      // It is allowed by DAP for the request to contain
      // no breakpoints. Not much we can do in this case.
      return;
    }
    const responseBreakpoints = response.body.breakpoints;
    // As per the DAP spec.
    if (requestBreakpoints.length !== responseBreakpoints.length) {
      logger.warn("Mismatching setBreakpoints requests vs. response length.");
      return;
    }

    const mergedBreakpoints = [] as Breakpoint[];

    for (let i = 0; i < requestBreakpoints.length; i++) {
      const requestBreakpoint = requestBreakpoints[i];
      const responseBreakpoint = responseBreakpoints[i];
      mergedBreakpoints.push({
        ...responseBreakpoint,
        line: responseBreakpoint.line ?? requestBreakpoint.line,
        ...("condition" in requestBreakpoint
          ? { condition: requestBreakpoint.condition }
          : {}),
      });
    }

    this.state.breakpoints.set(
      request.source.path ?? request.source.name,
      mergedBreakpoints,
    );

    this.fireStateChanged();
  }

  onDidSendMessage(msg: any) {
    logger.debug("Got DAP message", this.state.session.id, msg);
    try {
      {
        const parsed = z.safeParse(eventSchema, msg);
        if (parsed.success) {
          this.handleDAPEvent(parsed.data);
          return;
        }
      }
      {
        const parsed = z.safeParse(setBreakpointsResponseSchema, msg);
        if (parsed.success) {
          this.handleSetBreakpointsResponse(parsed.data);
        }
      }
    } catch (e) {
      logger.error("Caught exception while handling DAP event", e);
    }
  }

  onWillStopSession() {
    logger.debug("Debug session terminated", this.state.session.id);
    this.fireStateChanged();
    this.delState();
  }
}
