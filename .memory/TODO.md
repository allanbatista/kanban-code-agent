# [medium]Persist real task and chat uploads

Task modal and assistant chat now accept file selection/drag-drop in the UI and pass attachment names to the assistant prompt, but binary upload persistence is not implemented because the current daemon contract has no upload endpoint/storage flow. Next step: add backend file upload support and wire selected files to task storage/chat messages.
