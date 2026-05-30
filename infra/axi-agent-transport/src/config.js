'use strict';

module.exports = {
  // WebSocket orchestrator port (localhost only)
  port: 3721,

  // Agent limits
  maxWorkers: 7,
  defaultWorkers: 3,

  // Claude CLI invocation
  // --print          : non-interactive mode (stays alive reading stdin until EOF)
  // --output-format  : structured JSON per token (content_block_delta lines)
  // --input-format   : inject messages as JSON lines on stdin
  // --include-partial-messages : stream partial tokens as they arrive
  // Claude CLI invocation — use full path so it's found inside cmd.exe panes
  claudeCmd: 'C:\\Users\\12081\\AppData\\Roaming\\npm\\claude.cmd',
  claudeArgs: [
    '--dangerously-skip-permissions',
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
  ],

  // How long to wait (ms) for the orchestrator to bind before launching terminal
  orchestratorStartDelay: 800,

  // Prefix patterns Claude uses to route messages
  sendPattern: /^\[SEND:([\w-]+)\]\s*([\s\S]+)/,
  broadcastPattern: /^\[BROADCAST\]\s*([\s\S]+)/,
};
