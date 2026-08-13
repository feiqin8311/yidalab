import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    forceFinishInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ForceFinishSummaryInjector');

export interface ForceFinishSummaryInjectorConfig {
  /**
   * When true, tools are not fully stripped — only delivery tools (钉盘 upload)
   * remain. Prompt must tell the model to upload HTML, not just summarize.
   */
  deliveryOnly?: boolean;
  enabled: boolean;
  /** Human-readable brake reason (token cap / max steps / tool fail streak). */
  reason?: string;
}

/**
 * Force Finish Summary Injector
 *
 * When the agent hits a run brake (max steps / token cap / tool-fail streak),
 * append a system message that either:
 * - delivery-only: produce HTML + call uploadHtmlToDingpan, then short text
 * - pure finish: summarize progress without tools
 */
export class ForceFinishSummaryInjector extends BaseProvider {
  readonly name = 'ForceFinishSummaryInjector';

  constructor(
    private config: ForceFinishSummaryInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) {
      return this.markAsExecuted(context);
    }

    log('Injecting force-finish summary prompt deliveryOnly=%s', !!this.config.deliveryOnly);

    const clonedContext = this.cloneContext(context);
    const reason = this.config.reason?.trim();
    const reasonLine = reason
      ? `Run limit reason: ${reason}.`
      : 'A run limit was reached (steps, tokens, or repeated tool failures).';

    const content = this.config.deliveryOnly
      ? [
          reasonLine,
          'You are in DELIVERY-ONLY mode: research tools are disabled.',
          'Using ONLY data already in this conversation, produce a compact Chinese HTML report (no huge CSS, no full raw JSON dumps) and call lobe-dingpan → uploadHtmlToDingpan once.',
          'Do not call any other tools. Do not invent data. After the tool returns preview_url, final text = short plain-text bullets + the bare preview_url.',
          'If upload is impossible (missing content), say once that delivery failed and why — never claim upload success without preview_url.',
        ].join(' ')
      : [
          reasonLine,
          'Summarize your progress and provide a final response.',
          'Do not attempt to use any tools.',
        ].join(' ');

    clonedContext.messages.push({
      content,
      role: 'system' as const,
    });

    clonedContext.metadata.forceFinishInjected = true;

    return this.markAsExecuted(clonedContext);
  }
}
