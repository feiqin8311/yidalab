import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    compressedGroupRoleTransformProcessed?: number;
  }
}

const log = debug('context-engine:processor:CompressedGroupRoleTransformProcessor');

const escapeXml = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/**
 * Compressed Group Role Transform Processor
 *
 * Transforms messages with role='compressedGroup' to role='user' before
 * sending to the model. The 'compressedGroup' role is used for UI rendering
 * to display compressed/summarized conversation history, but models don't
 * understand this role.
 *
 * The compressed summary content is wrapped in a system context block to
 * provide historical context to the model.
 *
 * Flow:
 * 1. DB stores compression groups with role='compressedGroup'
 * 2. conversation-flow passes them through for UI rendering
 * 3. This processor transforms to role='user' with wrapped content before model API call
 *
 * @example
 * ```typescript
 * const processor = new CompressedGroupRoleTransformProcessor();
 * const result = await processor.process(context);
 * // All compressedGroup messages are now user messages with wrapped content
 * ```
 */
export class CompressedGroupRoleTransformProcessor extends BaseProcessor {
  readonly name = 'CompressedGroupRoleTransformProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      if (msg.role === 'compressedGroup') {
        processedCount++;
        log(`Transforming compressedGroup message to user role`);

        const meta = (msg as any).metadata as
          { snapshot?: { constraints?: any[]; decisions?: any[]; openItems?: any[] } } | undefined;
        const snapshot = meta?.snapshot;
        const anchorParts: string[] = [];

        if (snapshot?.constraints?.length) {
          const active = snapshot.constraints.filter((c: any) => c.status === 'active');
          const hard = active.filter((c: any) => c.strength === 'hard');
          const soft = active.filter((c: any) => c.strength === 'soft');
          if (hard.length || soft.length) {
            const lines = [
              ...hard.map((c: any) => `- [HARD] ${escapeXml(c.text)}`),
              ...soft.map((c: any) => `- [soft] ${escapeXml(c.text)}`),
            ];
            anchorParts.push(`<active_constraints>\n${lines.join('\n')}\n</active_constraints>`);
          }
        }
        if (snapshot?.decisions?.length) {
          anchorParts.push(
            `<confirmed_decisions>\n${snapshot.decisions.map((d: any) => `- ${escapeXml(d.text)}`).join('\n')}\n</confirmed_decisions>`,
          );
        }
        if (snapshot?.openItems?.length) {
          anchorParts.push(
            `<open_items>\n${snapshot.openItems.map((i: any) => `- ${escapeXml(i.text)}`).join('\n')}\n</open_items>`,
          );
        }

        // History summary is background; active anchors sit above it when present
        const summaryBlock = msg.content
          ? `<compressed_history_summary>\n${escapeXml(msg.content)}\n</compressed_history_summary>`
          : '';
        const wrappedContent = [...anchorParts, summaryBlock].filter(Boolean).join('\n\n');

        return {
          ...msg,
          content: wrappedContent,
          role: 'user',
        };
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.compressedGroupRoleTransformProcessed = processedCount;

    log(`Compressed group role transform completed: ${processedCount} messages processed`);

    return this.markAsExecuted(clonedContext);
  }
}
