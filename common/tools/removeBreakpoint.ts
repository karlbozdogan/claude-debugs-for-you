import { z } from 'zod';

const name = "removeBreakpoint";
const description = "Remove breakpoints across all files at a given line.";

const inputSchema = z.object({
    line: z.number()
});

export const tool = {name, description, inputSchema};