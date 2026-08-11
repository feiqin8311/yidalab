import { useParams } from 'react-router';

import { OperationsWorkbench } from '@/features/BusinessFunctions/Operations';

export default function OperationsFunctionRunPage() {
  const { functionId } = useParams<{ functionId: string }>();
  if (!functionId) return null;
  return <OperationsWorkbench functionId={functionId} />;
}
