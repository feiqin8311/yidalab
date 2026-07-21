import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import { describe, expect, it } from 'vitest';

import { getAgentRuntimeConfig } from '../../index';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { createSystemRole } from './systemRole';

const ARTIFACTS_SKILL_ID = 'lobe-artifacts';

const resolvePlugins = (plugins?: string[]) =>
  getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.inbox, { plugins })?.plugins ?? [];

describe('INBOX runtime plugins', () => {
  it('always pins Artifacts for default HTML/SVG/React deliverables', () => {
    expect(resolvePlugins()).toEqual([
      AgentDocumentsIdentifier,
      UserInteractionIdentifier,
      ARTIFACTS_SKILL_ID,
    ]);
  });

  it('systemRole offers Artifact vs 钉盘 choice; Artifact needs no file', () => {
    const role = createSystemRole('zh-CN', 'TestAgent');
    expect(role).toContain('lobeArtifact');
    expect(role).toContain('askUserQuestion');
    expect(role).toContain('uploadHtmlToDingpan');
    expect(role).toContain('聊天内预览（Artifact）');
    expect(role).toContain('钉盘链接');
    expect(role).toMatch(/No file|不生成文件/i);
    expect(role).toContain('/home/user/');
    expect(role).toContain('lobe-cloud-sandbox');
    expect(role).toMatch(/HARD RULES|Deliverable rules/i);
  });

  it('systemRole routes file delivery to lobe-dingpan, not OpenClaw memory paths', () => {
    const role = createSystemRole('zh-CN', 'TestAgent');
    expect(role).toContain('lobe-dingpan');
    expect(role).toContain('uploadToDingpan');
    expect(role).toContain('upload_to_ops_dingpan.sh');
    expect(role).toMatch(/skill \/ MCP descriptions|available skill/i);
  });

  it('merges non-company user plugins after builtin defaults', () => {
    expect(resolvePlugins(['lobe-user-memory', 'some-mcp'])).toEqual([
      AgentDocumentsIdentifier,
      UserInteractionIdentifier,
      ARTIFACTS_SKILL_ID,
      'lobe-user-memory',
      'some-mcp',
    ]);
  });

  it('strips company market skills so bulk pins do not bloat every Inbox turn', () => {
    expect(
      resolvePlugins([
        'company.EDZBVgrtWS4T',
        'lobe-user-memory',
        'company.19JVMwvPHZMC',
        ARTIFACTS_SKILL_ID,
      ]),
    ).toEqual([
      AgentDocumentsIdentifier,
      UserInteractionIdentifier,
      ARTIFACTS_SKILL_ID,
      'lobe-user-memory',
    ]);
  });
});
