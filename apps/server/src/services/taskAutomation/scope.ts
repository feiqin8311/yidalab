import { getV2QueryScope, type V2QueryScope } from './mode';

/** Map env allowlist → model listDueTasks / listDispatchableRuns scope args. */
export function toModelScope(scope: V2QueryScope = getV2QueryScope()): {
  includePersonal?: boolean;
  workspaceIds?: string[];
} | null {
  if (scope.kind === 'all') return null;
  if (scope.kind === 'none') return { includePersonal: false, workspaceIds: [] };
  return {
    includePersonal: scope.includePersonal,
    workspaceIds: scope.workspaceIds,
  };
}
