import { z } from 'zod';
import { ToolConfig } from './types';

const name = "launch";
const description = "Start the debug session.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;