'use strict';

function createCorrelationId({ sessionId, agentId, sequence }) {
  const cleanSession = String(sessionId || 'session').replace(/[^\w.-]+/g, '-');
  const cleanAgent = String(agentId || 'agent').replace(/[^\w.-]+/g, '-');
  const n = Number.isFinite(Number(sequence)) ? Number(sequence) : Date.now();
  return `${cleanSession}:${cleanAgent}:${n}`;
}

function createHeartbeatEnvelope({ sessionId, agentId, sequence = Date.now(), now = new Date() }) {
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    type: 'heartbeat',
    source: 'axi-agent-transport',
    session_id: String(sessionId || 'session'),
    agent_id: String(agentId || 'agent'),
    correlation_id: createCorrelationId({ sessionId, agentId, sequence }),
    status: 'alive',
    timestamp,
  };
}

function validateTelemetryEnvelope(envelope) {
  return Boolean(
    envelope &&
      envelope.type === 'heartbeat' &&
      envelope.source === 'axi-agent-transport' &&
      typeof envelope.session_id === 'string' &&
      typeof envelope.agent_id === 'string' &&
      typeof envelope.correlation_id === 'string' &&
      envelope.correlation_id.includes(envelope.session_id) &&
      envelope.status === 'alive' &&
      typeof envelope.timestamp === 'string'
  );
}

module.exports = {
  createCorrelationId,
  createHeartbeatEnvelope,
  validateTelemetryEnvelope,
};
