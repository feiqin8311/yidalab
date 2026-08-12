/**
 * Pick the assistant row owned by a given operation for orphan LOADING_FLAT settle.
 * Never uses unconstrained findLast on a shared message bucket (group / sub-agent).
 */
export function selectAssistantOwnedByOperation(params: {
  messageOperationMap?: Record<string, string>;
  messages: Array<{ content?: string | null; id: string; role?: string }>;
  operationId: string;
  operationsByMessage?: Record<string, string[]>;
  parentMessageId: string;
}): { content?: string | null; id: string; role?: string } | undefined {
  const { messageOperationMap, messages, operationId, operationsByMessage, parentMessageId } =
    params;

  const isOwnedByThisOp = (m: { id: string; role?: string }) => {
    if (messageOperationMap?.[m.id] === operationId) return true;
    const ops = operationsByMessage?.[m.id];
    if (Array.isArray(ops) && ops.includes(operationId)) return true;
    // Pre-created assistant used as parent when skipCreateFirstMessage
    if (m.id === parentMessageId && m.role === 'assistant') return true;
    return false;
  };

  return messages.findLast((m) => m.role === 'assistant' && isOwnedByThisOp(m));
}
