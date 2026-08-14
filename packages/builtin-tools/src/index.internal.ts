/**
 * YidaLab internal build profile — builtin tool manifests only.
 * Aliased over `./index.ts` when YIDALAB_BUILD_PROFILE=internal so unused
 * tool packages never enter the client/server import graph.
 */
import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import { BriefManifest } from '@lobechat/builtin-tool-brief';
import { CalculatorManifest } from '@lobechat/builtin-tool-calculator';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CredsManifest } from '@lobechat/builtin-tool-creds';
import { DingpanManifest } from '@lobechat/builtin-tool-dingpan';
import { FbaAlertManifest } from '@lobechat/builtin-tool-fba-alert';
import { FilesManifest } from '@lobechat/builtin-tool-files';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentManifest, resolveLobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LobeDeliveryCheckerManifest } from '@lobechat/builtin-tool-lobe-delivery-checker';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { MessageManifest } from '@lobechat/builtin-tool-message';
import { PageAgentManifest } from '@lobechat/builtin-tool-page-agent';
import { SkillStoreManifest } from '@lobechat/builtin-tool-skill-store';
import { resolveSkillsManifest, SkillsManifest } from '@lobechat/builtin-tool-skills';
import { TaskManifest } from '@lobechat/builtin-tool-task';
import { TopicReferenceManifest } from '@lobechat/builtin-tool-topic-reference';
import { UserInteractionManifest } from '@lobechat/builtin-tool-user-interaction';
import { VerifyToolManifest } from '@lobechat/builtin-tool-verify';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WorkbookManifest } from '@lobechat/builtin-tool-workbook';
import { isDesktop, RECOMMENDED_SKILLS, RecommendedSkillType } from '@lobechat/const';
import { type LobeBuiltinTool } from '@lobechat/types';

export const defaultToolIds = [
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  MemoryManifest.identifier,
  LocalSystemManifest.identifier,
  CloudSandboxManifest.identifier,
  TopicReferenceManifest.identifier,
  AgentDocumentsManifest.identifier,
  TaskManifest.identifier,
  LobeAgentManifest.identifier,
  DingpanManifest.identifier,
  WorkbookManifest.identifier,
  FilesManifest.identifier,
];

export const alwaysOnToolIds = [
  LobeAgentManifest.identifier,
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
  DingpanManifest.identifier,
  WorkbookManifest.identifier,
  FilesManifest.identifier,
];

export const activationModeControlledToolIds = [LobeActivatorManifest.identifier];

export const manualModeExcludeToolIds = [
  LobeActivatorManifest.identifier,
  SkillStoreManifest.identifier,
];

export const chatModeAllowedToolIds = [
  KnowledgeBaseManifest.identifier,
  MemoryManifest.identifier,
  WebBrowsingManifest.identifier,
  WorkbookManifest.identifier,
  FilesManifest.identifier,
];

export const groupSupervisorToolIds = [GroupManagementManifest.identifier];

export const runtimeManagedToolIds = [
  CloudSandboxManifest.identifier,
  KnowledgeBaseManifest.identifier,
  LocalSystemManifest.identifier,
  MemoryManifest.identifier,
  LobeAgentManifest.identifier,
  WebBrowsingManifest.identifier,
];

const builtinToolRegistry: LobeBuiltinTool[] = [
  {
    discoverable: false,
    hidden: true,
    identifier: VerifyToolManifest.identifier,
    manifest: VerifyToolManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: LobeActivatorManifest.identifier,
    manifest: LobeActivatorManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: SkillsManifest.identifier,
    manifest: SkillsManifest,
    resolveManifest: resolveSkillsManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: SkillStoreManifest.identifier,
    manifest: SkillStoreManifest,
    type: 'builtin',
  },
  {
    discoverable: isDesktop,
    hidden: true,
    identifier: LocalSystemManifest.identifier,
    manifest: LocalSystemManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: MemoryManifest.identifier,
    manifest: MemoryManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: WebBrowsingManifest.identifier,
    manifest: WebBrowsingManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: CloudSandboxManifest.identifier,
    manifest: CloudSandboxManifest,
    type: 'builtin',
  },
  {
    identifier: AgentDocumentsManifest.identifier,
    manifest: AgentDocumentsManifest,
    type: 'builtin',
  },
  {
    identifier: CredsManifest.identifier,
    manifest: CredsManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: KnowledgeBaseManifest.identifier,
    manifest: KnowledgeBaseManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: PageAgentManifest.identifier,
    manifest: PageAgentManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: AgentBuilderManifest.identifier,
    manifest: AgentBuilderManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: GroupManagementManifest.identifier,
    manifest: GroupManagementManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: AgentManagementManifest.identifier,
    manifest: AgentManagementManifest,
    type: 'builtin',
  },
  {
    identifier: CalculatorManifest.identifier,
    manifest: CalculatorManifest,
    type: 'builtin',
  },
  {
    identifier: WorkbookManifest.identifier,
    manifest: WorkbookManifest,
    type: 'builtin',
  },
  {
    identifier: FilesManifest.identifier,
    manifest: FilesManifest,
    type: 'builtin',
  },
  {
    identifier: DingpanManifest.identifier,
    manifest: DingpanManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: FbaAlertManifest.identifier,
    manifest: FbaAlertManifest,
    type: 'builtin',
  },
  {
    identifier: MessageManifest.identifier,
    manifest: MessageManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: TopicReferenceManifest.identifier,
    manifest: TopicReferenceManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: UserInteractionManifest.identifier,
    manifest: UserInteractionManifest,
    type: 'builtin',
  },
  {
    identifier: TaskManifest.identifier,
    manifest: TaskManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: BriefManifest.identifier,
    manifest: BriefManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: LobeAgentManifest.identifier,
    manifest: LobeAgentManifest,
    resolveManifest: resolveLobeAgentManifest,
    type: 'builtin',
  },
  {
    identifier: LobeDeliveryCheckerManifest.identifier,
    manifest: LobeDeliveryCheckerManifest,
    type: 'builtin',
  },
];

export const builtinTools: LobeBuiltinTool[] = builtinToolRegistry.map((tool) => ({
  ...tool,
  avatar: tool.manifest?.meta?.avatar,
  description: tool.manifest?.meta?.description,
  tags: tool.manifest?.meta?.tags,
  title: tool.manifest?.meta?.title,
}));

const recommendedBuiltinIds = new Set(
  RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Builtin).map((s) => s.id),
);

export const defaultUninstalledBuiltinTools = builtinTools
  .filter((t) => !t.hidden && !recommendedBuiltinIds.has(t.identifier))
  .map((t) => t.identifier);
