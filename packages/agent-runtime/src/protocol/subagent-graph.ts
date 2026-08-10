import type { OperationId } from './ids';

/**
 * Persistent parent/child execution edges (phase 7 types).
 * Sub-agents are independent operations linked by this graph.
 */

export type AgentExecutionRelationship = 'spawn' | 'delegate' | 'handoff';
export type AgentExecutionEdgeStatus = 'open' | 'completed' | 'failed' | 'cancelled';

export interface AgentExecutionEdge {
  callId: string;
  childOperationId: OperationId;
  closedAt?: number;
  createdAt: number;
  parentOperationId: OperationId;
  relationship: AgentExecutionRelationship;
  status: AgentExecutionEdgeStatus;
}

export interface SubagentGraphStore {
  close: (
    childOperationId: OperationId,
    status: Exclude<AgentExecutionEdgeStatus, 'open'>,
  ) => Promise<void>;
  getChildren: (parentOperationId: OperationId) => Promise<AgentExecutionEdge[]>;
  /** BFS descendants. */
  getDescendants: (parentOperationId: OperationId) => Promise<AgentExecutionEdge[]>;
  getParent: (childOperationId: OperationId) => Promise<AgentExecutionEdge | null>;
  open: (
    edge: Omit<AgentExecutionEdge, 'status' | 'closedAt'> & { status?: 'open' },
  ) => Promise<void>;
}

export class InMemorySubagentGraphStore implements SubagentGraphStore {
  private readonly edges: AgentExecutionEdge[] = [];

  async open(
    edge: Omit<AgentExecutionEdge, 'status' | 'closedAt'> & { status?: 'open' },
  ): Promise<void> {
    const existing = this.edges.find((e) => e.childOperationId === edge.childOperationId);
    if (existing) return;
    this.edges.push({
      ...edge,
      status: edge.status ?? 'open',
    });
  }

  async close(
    childOperationId: OperationId,
    status: Exclude<AgentExecutionEdgeStatus, 'open'>,
  ): Promise<void> {
    const edge = this.edges.find((e) => e.childOperationId === childOperationId);
    if (!edge || edge.status !== 'open') return;
    edge.status = status;
    edge.closedAt = Date.now();
  }

  async getChildren(parentOperationId: OperationId): Promise<AgentExecutionEdge[]> {
    return this.edges.filter((e) => e.parentOperationId === parentOperationId);
  }

  async getParent(childOperationId: OperationId): Promise<AgentExecutionEdge | null> {
    return this.edges.find((e) => e.childOperationId === childOperationId) ?? null;
  }

  async getDescendants(parentOperationId: OperationId): Promise<AgentExecutionEdge[]> {
    const result: AgentExecutionEdge[] = [];
    const queue = [parentOperationId];
    const seen = new Set<OperationId>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const children = await this.getChildren(id);
      for (const child of children) {
        result.push(child);
        queue.push(child.childOperationId);
      }
    }
    return result;
  }
}
