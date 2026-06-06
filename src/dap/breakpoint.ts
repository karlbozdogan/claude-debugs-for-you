import { z } from "zod";
import { SourceSchema } from "./source";

export const BreakpointSchema = z.object({
  id: z.int().optional(),
  verified: z.boolean(),
  source: SourceSchema.optional(),
  line: z.int().optional(),
  column: z.int().optional(),
});
