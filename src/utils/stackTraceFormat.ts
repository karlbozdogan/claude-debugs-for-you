import { z } from "zod";

export function cleanStackFrames(stackFrames_: any) {
  const stackFramesSchema = z.array(
    z.object({
      line: z.number(),
      source: z
        .object({
          name: z.string().optional(),
          path: z.string().optional(),
        })
        .loose()
        .optional(),
      id: z.number(),
      name: z.string(),
      column: z.number(),
      presentationHint: z.string().optional(),
    }),
  );

  const stackFrames = stackFramesSchema.parse(stackFrames_);

  const stackFramesTransformed = stackFrames.map((frame) => {
    if (!frame.source?.path) {
      return frame;
    }
    let pathURL;
    try {
      pathURL = new URL(frame.source.path);
    } catch (e) {
      return frame;
    }
    return {
      ...frame,
      source: {
        ...frame.source,
        path:
          pathURL.protocol === "vscode-remote:"
            ? pathURL.pathname
            : pathURL.toString(),
      },
    };
  });

  return stackFramesTransformed;
}

export function formatStackFrames(
  stackFrames: ReturnType<typeof cleanStackFrames>,
): string {
  // Collapse internal frames
  const res = stackFrames.reduce(
    ({ internalFramesCounter, acc }, frame) => {
      if (frame.presentationHint === "subtle") {
        return { internalFramesCounter: internalFramesCounter + 1, acc };
      } else {
        return {
          internalFramesCounter: 0,
          acc: `${acc}${internalFramesCounter > 0 ? `... (${internalFramesCounter} internal frames)\n` : ""}${JSON.stringify(frame)}\n`,
        };
      }
    },
    { internalFramesCounter: 0, acc: "" },
  );
  // Handle trailing internal frames
  return (
    res.acc +
    (res.internalFramesCounter > 0
      ? `... (${res.internalFramesCounter} internal frames)`
      : "")
  );
}

export function formatStackFrames2(
  stackFrames: ReturnType<typeof cleanStackFrames>,
): unknown[] {
  // Collapse internal frames
  const res = [] as unknown[];
  let internalFramesCounter = 0;
  for (const frame of stackFrames) {
    if (frame.presentationHint === "subtle") {
      internalFramesCounter++;
    } else {
      if (internalFramesCounter > 0) {
        res.push({ numOmittedInternalFrames: internalFramesCounter });
        internalFramesCounter = 0;
      }
      res.push({
        id: frame.id,
        line: frame.line,
        name: frame.name,
        file: frame.source?.name ?? frame.source?.path ?? "<unknown>",
      });
    }
  }
  if (internalFramesCounter > 0) {
     res.push({ numOmittedInternalFrames: internalFramesCounter });
  }
  return res;
}
