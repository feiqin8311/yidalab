import { createHash } from 'node:crypto';

const getToolName = (tool: unknown): string => {
  if (!tool || typeof tool !== 'object' || !('function' in tool)) return '';
  const fn = tool.function;
  if (!fn || typeof fn !== 'object' || !('name' in fn)) return '';
  return typeof fn.name === 'string' ? fn.name : '';
};

export const sortToolsForStablePrompt = <T>(tools: T[]): T[] =>
  [...tools].sort((left, right) => getToolName(left).localeCompare(getToolName(right)));

export const createPromptFingerprint = (input: { messages: unknown[]; tools: unknown[] }) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
