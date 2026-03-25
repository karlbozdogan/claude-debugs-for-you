import { z } from 'zod';

const name = "evaluate";
const description = "Evaluate a given expression at the active stack frame.";

const inputSchema = z.object({
    expression: z.string()
});

export const tool = {name, description, inputSchema};