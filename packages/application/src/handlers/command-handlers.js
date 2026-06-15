export const publicCommandTypes = [
  "task.create",
  "task.update",
  "task.file.write",
  "task.attachment.write",
  "task.move",
  "task.run",
  "task.interrupt",
  "task.decompose",
  "task.merge",
  "agent.complete_task",
  "agent.report_blocker",
  "agent.request_user_input",
  "agent.emit_artifact",
  "agent.chat",
  "agent.message",
  "agent.wait_for_persona",
  "agent.wait_for_human",
  "agent.delegate_task",
  "agent.step",
  "chat.compact",
  "task.answer_input",
  "role.route_task",
  "agent.review_task",
  "agent.deploy_task",
  "settings.update"
];

export function createCommandHandlers(executeCommand) {
  return Object.fromEntries(publicCommandTypes.map((type) => [type, (command, context) => executeCommand(command, context)]));
}
