import { z } from 'zod';

const name = "launch";
const description = "Start the debug session.";

const inputSchema = z.object({});

export const tool = {name, description, inputSchema};