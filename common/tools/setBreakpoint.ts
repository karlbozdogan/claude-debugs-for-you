import { z } from 'zod';

const name = "setBreakpoint";
const description = "Set a breakpoint. Use absolute local file paths (e.g. `/home/user/...`).";

const inputSchema = z.object({
    file: z
      .string(),
    line: z.number(),
    condition: z
      .string()
      .optional(),
  });

export const tool = {name, description, inputSchema};