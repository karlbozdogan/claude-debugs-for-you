import * as cont from './continue';
import * as evaluate from './evaluate';
import * as launch from './launch';
import * as removeBreakpoint from './removeBreakpoint';
import * as setBreakpoint from './setBreakpoint';
import * as variables from './variables';

// Main tools array with Zod schemas
export const tools = [
    cont.tool,
    evaluate.tool,
    launch.tool,
    removeBreakpoint.tool,
    setBreakpoint.tool,
    variables.tool,

];