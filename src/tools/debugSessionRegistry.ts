import * as vscode from "vscode";
import { z } from "zod";
import { ContinuedSchema } from "../dap/events/continued";
import { ExitedSchema } from "../dap/events/exited";
import { StoppedSchema } from "../dap/events/stopped";
import { logger } from "../logger";

export type InitializingState = { type: "initializing"};
export type RunningState = {type: "running"};
export type StoppedState = {type: "stopped"; threadId: number;};
export type ExitedState = {type: "exited"};

export interface DebugSessionState {
  readonly session: vscode.DebugSession;
  
  readonly state: InitializingState | RunningState | StoppedState | ExitedState;
}

class DebugSessionStateImpl implements DebugSessionState {
  readonly session: vscode.DebugSession;
  state: DebugSessionState["state"] = {type: "initializing"};

  constructor(session: vscode.DebugSession) {
    this.session = session;
  }
}

export class DebugSessionRegistry {
  private readonly _sessions = new Map<string, DebugSessionStateImpl>();

  constructor(context: vscode.ExtensionContext) {
    const self = this;

    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session: vscode.DebugSession) {
        logger.debug("Debug session started", session);
        const debugSessionState = new DebugSessionStateImpl(session);
        self._sessions.set(session.id, debugSessionState);
        const delState = () => self._sessions.delete(session.id);
        return new DebugSessionTracker(debugSessionState, delState);
      },
    });
  }

  getSessions(): ReadonlyMap<string, DebugSessionState> {
    return this._sessions;
  }
}

const eventSchema = z.discriminatedUnion("event", [
  ContinuedSchema,
  ExitedSchema,
  StoppedSchema,
]);

class DebugSessionTracker {
  state: DebugSessionStateImpl;
  delState: () => void;

  constructor(state: DebugSessionStateImpl, delState: () => void) {
    this.state = state;
    this.delState = delState;
  }

  onWillReceiveMessage(msg: any) {
    logger.debug("Editor sending DAP message", this.state.session.id, msg);
  }

  onDidSendMessage(msg: any) {
    logger.debug("Got DAP message", this.state.session.id, msg);
    try {
      const parsed = z.safeParse(eventSchema, msg);
      if (!parsed.success) {
        return;
      }
      const event = parsed.data;
      logger.debug("Got DAP event", this.state.session.id, event);
      switch (event.event) {
        case "continued":
          this.state.state = {type: "running"};
          break;
        case "exited":
          this.state.state = {type: "exited"};
          break;
        case "stopped":
          this.state.state = {type: "stopped", threadId: event.body.threadId};
          break;
        default:
          event satisfies never;
      }
    } catch (e) {
      logger.error("Caught exception while handling DAP event", e);
    }
  }

  onWillStopSession() {
    logger.debug("Debug session terminated", this.state.session.id);
    this.delState();
  }
}
