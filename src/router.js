import { classifier } from "./models/classifier.js";

export async function router(info) {
  const { message } = info;

  /*
  "needs_plugin_work",
  "needs_server_action",
  "needs_web_search_or_live_data",
  "needs_structured_planning",
  "needs_multistep_server_workflow",
  "needs_code_execution_or_debugging_or_testing",
  "needs_large_workflow"
  */
  const routingFlags = await classifier(message);

  console.log(JSON.stringify(routingFlags, null, 2));

  const complexFlags = [routingFlags.needs_large_workflow, routingFlags.needs_code_execution_or_debugging_or_testing, routingFlags.needs_multiple_server_actions];

  if (complexFlags.some(boolean => boolean)) {
    message.reply("Complex");
  } else if (Object.values(routingFlags).some(boolean => boolean)) {
    message.reply("Moderate");
  } else {
    message.reply("Simple");
  }

}