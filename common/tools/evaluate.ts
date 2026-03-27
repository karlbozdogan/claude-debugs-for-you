import { z } from 'zod';
import { ToolConfig } from './types';

const name = "evaluate";
const description = "Evaluate a given expression at a given stack frame.";

const inputSchema = z.object({
    expression: z.string(),
    frameId: z.coerce.number(),
});

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;