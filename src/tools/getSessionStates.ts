import { z } from "zod";
import { ToolConfig } from "./types";
import { stackTrace } from "../utils/dap/stackTrace";
import { cleanStackFrames, formatStackFrames2 } from "../utils/stackTraceFormat";
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
  return JSON.stringify(
    Object.fromEntries(
      await mapMapValuesAsync(
        debugSessionRegistry.getSessions(),
        async (sessionState) => {
          switch (sessionState.state.type) {
            case "initializing":
            case "running":
            case "exited":
              return {state: sessionState.state.type};
            case "stopped":
              const stack = await stackTrace(
                sessionState.session,
                sessionState.state.threadId,
              );
              const frames = formatStackFrames2(
                cleanStackFrames(stack.stackFrames),
              );
              return {state: "stopped", frames};
            default:
              sessionState.state satisfies never;
          }
        },
      ),
    ),
  );
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
