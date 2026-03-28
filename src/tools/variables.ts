import { z } from 'zod';

const name = "variables";
const description = "Retrieves all child variables for the given variable reference.";

const inputSchema = z.object({
    // Claude sometimes passes numbers as strings by mistake
    variablesReference: z.coerce.number()
});

export const tool = {name, description, inputSchema};