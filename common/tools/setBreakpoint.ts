import { z } from 'zod';
import { ToolConfig } from './types';

const name = "setBreakpoint";
const description = "Set a breakpoint. Use absolute local file paths (e.g. `/home/user/...`).";

const inputSchema = z.object({
    file: z
      .string(),
    line: z.coerce.number(),
    condition: z
      .string()
      .optional(),
  });

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;