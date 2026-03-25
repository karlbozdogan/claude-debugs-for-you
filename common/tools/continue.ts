import { z } from 'zod';

const name = "continue";
const description = "Continue execution from a breakpoint, wait until execution pauses and return the stack trace.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema};