export enum RecommendedSkillType {
  Builtin = 'builtin',
  Composio = 'composio',
  Lobehub = 'lobehub',
}

export interface RecommendedSkillItem {
  id: string;
  type: RecommendedSkillType;
}

export const RECOMMENDED_SKILLS: RecommendedSkillItem[] = [
  // Builtin skills
  { id: 'lobe-artifacts', type: RecommendedSkillType.Builtin },
  { id: 'lobe-user-memory', type: RecommendedSkillType.Builtin },
  // lobe-cloud-sandbox omitted: YidaLab has no market cloud sandbox provisioned
  // (ENABLE_CLOUD_SANDBOX off). Re-add when sandbox is re-enabled.
  { id: 'lobe-task', type: RecommendedSkillType.Builtin },
  { id: 'lobe-agent-documents', type: RecommendedSkillType.Builtin },
  { id: 'lobe-message', type: RecommendedSkillType.Builtin },
  // Company DingTalk Drive upload (YidaLab / second-party)
  { id: 'lobe-dingpan', type: RecommendedSkillType.Builtin },
  // LobeHub skills
  { id: 'notion', type: RecommendedSkillType.Lobehub },
  { id: 'posthog', type: RecommendedSkillType.Lobehub },
  { id: 'twitter', type: RecommendedSkillType.Lobehub },
  // Composio skills
  { id: 'gmail', type: RecommendedSkillType.Composio },
  { id: 'google-drive', type: RecommendedSkillType.Composio },
  { id: 'google-calendar', type: RecommendedSkillType.Composio },
  { id: 'slack', type: RecommendedSkillType.Composio },
];
