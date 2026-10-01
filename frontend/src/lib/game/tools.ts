export const EDITOR_TOOLS = ['select', 'eraser', 'characterSwap', 'winCondition', 'hazard'] as const;
export type EditorTool = (typeof EDITOR_TOOLS)[number];
export const EDITOR_TOOL_REGISTRY_KEY = 'editorTool';
export const DEFAULT_EDITOR_TOOL: EditorTool = 'select';