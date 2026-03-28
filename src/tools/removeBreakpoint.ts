import { z } from 'zod';
import { ToolConfig } from './types';

const name = "removeBreakpoint";
const description = "Remove breakpoints across all files at a given line.";

const inputSchema = z.object({
    line: z.coerce.number()
});

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;