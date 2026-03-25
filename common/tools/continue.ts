import { z } from 'zod';

const name = "continue";
const description = "Continue execution from a breakpoint.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema};