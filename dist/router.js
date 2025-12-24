import { classifier } from "./agents/classifier.js";
import { moderate } from "./agents/moderate.js";
import { nano } from "./agents/nano.js";
export async function router(info, toolHistory) {
    const { message } = info;
    /*
    "needs_plugin_work",
    "needs_server_action",
    "needs_recent_data",
    "needs_structured_planning",
    "needs_to_browse_web",
    "needs_document_access",
    
    "needs_multiple_server_actions",
    "needs_code_execution_or_debugging_or_testing",
    "needs_large_workflow"
    */
    const routingFlags = await classifier(message);
    console.log(JSON.stringify(routingFlags, null, 2));
    const complexFlags = [routingFlags.needs_large_workflow, routingFlags.needs_code_execution_or_debugging_or_testing, routingFlags.needs_multiple_server_actions];
    if (complexFlags.some((flag) => flag)) {
        return {
            messages: [await message.reply("Placeholder for complex responder")],
            isClarification: false,
            responder: "complex"
        };
    }
    else if (Object.values(routingFlags).some((flag) => Boolean(flag))) {
        return await moderate(info, toolHistory);
    }
    else {
        return await nano(info, toolHistory);
    }
}
