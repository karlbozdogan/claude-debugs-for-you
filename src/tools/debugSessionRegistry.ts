import * as vscode from "vscode";
import { z } from "zod";
import { ContinuedSchema } from "../dap/events/continued";
import { ExitedSchema } from "../dap/events/exited";
import { StoppedSchema } from "../dap/events/stopped";
import { logger } from "../logger";

export type InitializingState = { type: "initializing" };
export type RunningState = { type: "running" };
export type StoppedState = { type: "stopped"; threadId: number };
export type ExitedState = { type: "exited" };

export interface DebugSessionState {
  readonly session: vscode.DebugSession;

  readonly state: InitializingState | RunningState | StoppedState | ExitedState;
}

class DebugSessionStateImpl implements DebugSessionState {
  readonly session: vscode.DebugSession;
  state: DebugSessionState["state"] = { type: "initializing" };

  constructor(session: vscode.DebugSession) {
    this.session = session;
  }
}

export class DebugSessionRegistry {
  private readonly _sessions = new Map<string, DebugSessionStateImpl>();
  private _trackerFactoryRegistration: vscode.Disposable | undefined;
  private readonly _onStateChanged = new vscode.EventEmitter<string>();
  readonly onStateChanged = this._onStateChanged.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(this._onStateChanged);
  }

  startTracking() {
    if (this._trackerFactoryRegistration) {
      return;
    }

    const self = this;

    this._trackerFactoryRegistration =
      vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker(session: vscode.DebugSession) {
          logger.debug("Debug session started", session);
          const debugSessionState = new DebugSessionStateImpl(session);
          self._sessions.set(session.id, debugSessionState);
          self._onStateChanged.fire(session.id);
          const delState = () => self._sessions.delete(session.id);
          const fireStateChanged = () => self._onStateChanged.fire(session.id);
          return new DebugSessionTracker(
            debugSessionState,
            delState,
            fireStateChanged,
          );
        },
      });
  }

  stopTracking() {
    this._trackerFactoryRegistration?.dispose();
    this._trackerFactoryRegistration = undefined;
    this._sessions.clear();
  }

  getSessions(): ReadonlyMap<string, DebugSessionState> {
    return this._sessions;
  }

  tryGetSession(id: string): DebugSessionState | undefined {
    return this._sessions.get(id);
  }

  getSessionOrTheStopped(id: string | undefined): DebugSessionState {
    if (typeof id === "undefined") {
      if (this._sessions.size === 0) {
        throw new Error("There are no debug sessions.");
      }
      const stoppedSessions = [...this._sessions.values()].filter(
        (x) => x.state.type === "stopped",
      );
      if (stoppedSessions.length === 1) {
        return stoppedSessions[0];
      } else {
        throw new Error(
          "There are multiple stopped debug sessions. You need to pick a specific one. Use `getSessionStates` if necessary.",
        );
      }
    }
    const session = this.tryGetSession(id);
    if (!session) {
      throw new Error(
        "Session not found. If it existed, it might have exited.",
      );
    }
    return session;
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
          this.state.state = { type: "running" };
          break;
        case "exited":
          this.state.state = { type: "exited" };
          break;
        case "stopped":
          this.state.state = { type: "stopped", threadId: event.body.threadId };
          break;
        default:
          event satisfies never;
      }
      this.fireStateChanged();
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
