import { z } from "zod";

export const SourceSchema = z.object({
    name: z.string(),
    path: z.string().optional()
});
