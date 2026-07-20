/** Friendly labels for common tool identifiers; falls back to the raw id. */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'company.mcp.lingxing-mcp': '领星',
  'company.mcp.sellersprite-mcp': '卖家精灵',
  'company.mcp.sif-mcp': 'SIF',
  'lobe-activator': 'Tools Activator',
  'lobe-agent': 'Agent',
  'lobe-artifacts': 'Artifacts',
  'lobe-cloud-sandbox': 'Cloud Sandbox',
  'lobe-skills': 'Skills',
  'lobe-web-browsing': 'Web Browsing',
};

export function toolDisplayName(identifier: string): string {
  return TOOL_DISPLAY_NAMES[identifier] ?? identifier;
}
