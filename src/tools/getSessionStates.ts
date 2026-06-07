import { z } from "zod";
import { ToolConfig } from "./types";
import { stackTrace } from "../utils/dap/stackTrace";
import {
  cleanStackFrames,
  formatStackFrames,
} from "../utils/stackTraceFormat";
import { DebugSessionRegistry } from "./debugSessionRegistry";

const name = "getSessionStates";
const description =
  "Get the state of the debug sessions, including a stack trace for the stopped thread per debug session in which the debuggee is stopped.";

const inputSchema = z.object({});

async function mapMapValuesAsync<K, V, U>(
  map: ReadonlyMap<K, V>,
  f: (v: V) => Promise<U>,
): Promise<Map<K, U>> {
  const res = new Map<K, U>();
  for (const [k, v] of map.entries()) {
    res.set(k, await f(v));
  }
  return res;
}

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
): Promise<string> {
  const sessions = debugSessionRegistry.getSessions();
  if (sessions.size === 0) {
    return "There are no debug sessions.";
  }

  return JSON.stringify(
    Object.fromEntries(
      await mapMapValuesAsync(
        sessions,
        async (sessionState) => {
          return {
            state: sessionState.state.type,
            name: sessionState.session.name,
            pid: sessionState.session.configuration.pid ?? "<unknown>",
            ...(sessionState.state.type === "stopped"
              ? {
                  frames: await (async (stoppedState) => {
                    const stack = await stackTrace(
                      sessionState.session,
                      stoppedState.threadId,
                    );
                    const frames = formatStackFrames(
                      cleanStackFrames(stack.stackFrames),
                    );
                    return frames;
                  })(sessionState.state),
                }
              : {}),
          };
        },
      ),
    ),
  );
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
