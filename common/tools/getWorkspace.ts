import { z } from 'zod';
import { ToolConfig } from './types';

const name = "getWorkspace";
const description = "Get the active workspace.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;