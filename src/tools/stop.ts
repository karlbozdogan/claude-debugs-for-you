import { z } from 'zod';
import { ToolConfig } from './types';

const name = "stop";
const description = "Stop the debug session. This is the opposite of launch.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;