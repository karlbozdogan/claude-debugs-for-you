import { z } from 'zod';

const name = "launch";
const description = "Start the debug session, wait until execution pauses and return the stack trace.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema};