export interface Settings {
  targetChars: number;
  maxCalls: number;
  contextTokens: number;
  writerId: string;
  reviewerId: string;
  autoReview: boolean;
  autoNext: boolean;
}
export interface Style {
  preset: string;
  perspective: string;
  rhythm: string;
  dialogue: string;
  description: string;
  tone: string;
  avoid: string;
  revision: number;
}
export interface Version {
  id: string;
  chapterId: string;
  number: number;
  content: string;
  author: string;
  baseVersionId: string;
  createdAt: number;
  branch: boolean;
}
export interface Chapter {
  id: string;
  title: string;
  volume: string;
  goal: string;
  events: string;
  forbidden: string;
  ending: string;
  locked: boolean;
  outlineRevision: number;
  editRevision: number;
  working: string;
  currentVersionId: string;
  approvedVersionId: string;
  versions: Version[];
  summary: string;
  summaryVersionId: string;
  summaryStale: boolean;
  upstreamChanged: boolean;
}
export interface Character {
  id: string;
  name: string;
  role: string;
  aliases: string;
  profile: string;
  state: string;
  knowledge: string;
  x: number;
  y: number;
  deleted: boolean;
}
export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  direction: string;
  startOrder: number;
  endOrder: number | null;
  visibility: string;
  source: string;
}
export interface Fact {
  id: string;
  category: string;
  subjectId: string;
  predicate: string;
  value: string;
  locked: boolean;
  certainty: string;
  visibility: string;
  startOrder: number;
  endOrder: number | null;
  sourceVersionId: string;
  excerpt: string;
  needsRevalidation: boolean;
}
export interface Proposal {
  id: string;
  sourceVersionId: string;
  fact: Fact;
  status: string;
  verified: boolean;
  conflict: string;
}
export interface Evidence {
  sourceId: string;
  sourceVersionId: string;
  quote: string;
}
export interface Issue {
  issueId: string;
  kind: string;
  severity: string;
  claim: string;
  quote: string;
  conflictEvidence: Evidence | null;
  suggestion: string;
  confidence: string;
  verified: boolean;
  decision: string;
  note: string;
}
export interface Report {
  id: string;
  chapterVersionId: string;
  summary: string;
  issues: Issue[];
  stale: boolean;
  createdAt: number;
}
export interface Project {
  writingPreset: WritingPreset | null;
  pdfBook: { documentId: string } | null;
  readingMarks: ReadingMark[];
  bookOutline: BookOutline[];
  bookContent: BookContent[];
  coverImageId: string;
  bookSource: string;
  reader: ReaderState;
  visualSettings: VisualSettings;
  visualProfiles: VisualProfile[];
  visualChanges: VisualChange[];
  artwork: Artwork[];
  id: string;
  title: string;
  genre: string;
  perspective: string;
  outline: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  style: Style;
  chapters: Chapter[];
  characters: Character[];
  relations: Relation[];
  facts: Fact[];
  proposals: Proposal[];
  reports: Report[];
}
export interface ProjectCard {
  readingProgress: number;
  lastReadAt: number;
  coverImageId: string;
  bookSource: string;
  id: string;
  title: string;
  genre: string;
  chapters: number;
  updatedAt: number;
}
export const MAX_CONTEXT_TOKENS = 2_000_000;
export const MAX_OUTPUT_TOKENS = 393_216;
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  allowLocalHttp: boolean;
  tokenParameter: string;
  jsonMode: boolean;
  thinkingMode: "auto" | "enabled" | "disabled";
  temperature: number | null;
  maxTokens: number;
  timeoutSeconds: number;
  hasKey: boolean;
  keyStorage: string;
}
export interface AppError {
  code: string;
  userMessage: string;
  retryable: boolean;
  correlationId: string;
}
export interface ContextItem {
  id: string;
  versionId: string;
  label: string;
  text: string;
  priority: number;
  estimatedTokens: number;
}
export interface ContextBundle {
  items: ContextItem[];
  omitted: string[];
  estimatedTokens: number;
  hash: string;
}
export interface Preflight {
  writingPreview: PresetPreview | null;
  context: ContextBundle;
  sceneCount: number;
  estimatedCalls: number;
  targetChars: number;
  maxCalls: number;
  warnings: string[];
  destination: string;
}
export interface Segment {
  index: number;
  status: string;
  text: string;
  finishReason: string;
  hanCount: number;
}
export interface Run {
  id: string;
  projectId: string;
  chapterId: string;
  task: string;
  status: string;
  segments: Segment[];
  error: AppError | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  createdAt: number;
  resultVersionId: string;
  recoveredFrom: string;
  snapshot: {
    sceneCount: number;
    context: ContextBundle;
    provider: Provider;
    overrideReason: string;
  };
}
export type Mutation =
  | { type: "modelSelection"; role: "writer" | "reviewer"; provider_id: string }
  | { type: "writingPreset"; preset: WritingPreset | null }
  | { type: "readingMark"; mark: ReadingMark }
  | { type: "deleteReadingMark"; mark_id: string }
  | {
      type: "visualExtraction";
      profiles: VisualProfileCandidate[];
      changes: VisualChangeCandidate[];
      overwrite_existing: boolean;
    }
  | { type: "reader"; state: ReaderState }
  | { type: "visualSettings"; settings: VisualSettings }
  | { type: "visualProfile"; profile: VisualProfile }
  | { type: "visualChange"; change: VisualChange }
  | { type: "deleteVisualChange"; change_id: string }
  | { type: "artwork"; artwork_id: string; approved: boolean }
  | {
      type: "metadata";
      title: string;
      genre: string;
      perspective: string;
      outline: string;
      settings: Settings;
    }
  | { type: "addChapter" | "outline"; chapter: Chapter }
  | { type: "moveChapter"; chapter_id: string; direction: number }
  | { type: "character"; character: Character }
  | { type: "relation"; relation: Relation }
  | { type: "deleteRelation"; relation_id: string }
  | { type: "fact"; fact: Fact }
  | { type: "deleteFact"; fact_id: string }
  | { type: "style"; style: Style }
  | { type: "proposal"; proposal_id: string; accept: boolean }
  | {
      type: "issue";
      report_id: string;
      issue_id: string;
      decision: string;
      note: string;
    }
  | { type: "summary"; chapter_id: string; summary: string }
  | { type: "acknowledge"; chapter_id: string };
export type View =
  | "reader"
  | "illustrations"
  | "home"
  | "writer"
  | "outline"
  | "characters"
  | "memory"
  | "style"
  | "settings";

export interface PresetParameters {
  temperature: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxTokens: number | null;
  seed: number | null;
  stop: string[];
}
export interface PromptEntry {
  identifier: string;
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  marker: boolean;
  system_prompt: boolean;
  injection_position: number;
  injection_depth: number;
  injection_order: number;
  injection_trigger: string[];
  [key: string]: unknown;
}
export interface WritingPreset {
  id: string;
  name: string;
  description: string;
  source: string;
  prompts: PromptEntry[];
  orders: {
    character_id: number | string;
    order: { identifier: string; enabled: boolean }[];
  }[];
  activeOrder: number;
  parameters: PresetParameters;
  useParameters: boolean;
  charName: string;
  userName: string;
  persona: string;
  examples: string;
  blockUnknownMacros: boolean;
  importWarnings: string[];
}
export interface PresetPreview {
  presetName: string;
  messages: { role: string; content: string }[];
  warnings: string[];
  unresolvedMacros: string[];
  estimatedTokens: number;
  parameters: Record<string, unknown>;
  canGenerate: boolean;
}
export const hanCount = (text: string) =>
  [...text].filter((c) => /\p{Script=Han}/u.test(c)).length;
export const approved = (c: Chapter) =>
  !!c.approvedVersionId &&
  c.approvedVersionId === c.currentVersionId &&
  c.versions.some(
    (v) => v.id === c.currentVersionId && v.content === c.working,
  );
export const status = (c: Chapter) =>
  approved(c) ? "已确认" : c.working.trim() ? "草稿" : "待写作";
export const blankChapter = (title = "新的章节"): Chapter => ({
  id: "",
  title,
  volume: "第一卷",
  goal: "",
  events: "",
  forbidden: "",
  ending: "",
  locked: false,
  outlineRevision: 1,
  editRevision: 0,
  working: "",
  currentVersionId: "",
  approvedVersionId: "",
  versions: [],
  summary: "",
  summaryVersionId: "",
  summaryStale: false,
  upstreamChanged: false,
});
export const blankCharacter = (): Character => ({
  id: "",
  name: "",
  role: "",
  aliases: "",
  profile: "",
  state: "",
  knowledge: "",
  x: 140,
  y: 120,
  deleted: false,
});
export const blankRelation = (): Relation => ({
  id: "",
  fromId: "",
  toId: "",
  kind: "",
  direction: "one",
  startOrder: 1,
  endOrder: null,
  visibility: "world_public",
  source: "作者设定",
});
export const blankFact = (): Fact => ({
  id: "",
  category: "world",
  subjectId: "",
  predicate: "",
  value: "",
  locked: false,
  certainty: "confirmed",
  visibility: "world_public",
  startOrder: 1,
  endOrder: null,
  sourceVersionId: "",
  excerpt: "",
  needsRevalidation: false,
});
export const blankProvider = (): Provider => ({
  id: crypto.randomUUID(),
  name: "新模型",
  baseUrl: "https://api.openai.com/v1",
  modelId: "",
  allowLocalHttp: false,
  tokenParameter: "max_tokens",
  jsonMode: false,
  thinkingMode: "auto",
  temperature: 0.7,
  maxTokens: 4096,
  timeoutSeconds: 120,
  hasKey: false,
  keyStorage: "none",
});
export const categoryLabels: Record<string, string> = {
  world: "世界规则",
  character: "人物状态",
  relation: "人物关系",
  timeline: "时间线",
  item: "道具去向",
  foreshadow: "伏笔",
  knowledge: "人物知识",
};
export const visibilityLabels: Record<string, string> = {
  world_public: "世界公开",
  reader_known: "读者已知",
  character_subset: "仅指定人物知晓",
  author_only: "仅作者知晓",
};
export const taskLabels: Record<string, string> = {
  write: "生成本章",
  review: "副 AI 审稿",
  remember: "摘要与记忆",
  revise: "定点修订",
};
export const runLabels: Record<string, string> = {
  running: "运行中",
  succeeded: "完成",
  failed: "未完成",
  cancelled: "已取消",
  interrupted: "上次中断",
};
export interface Bookmark {
  id: string;
  chapterId: string;
  offset: number;
  label: string;
}
export interface PdfRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ReadingMark {
  id: string;
  chapterId: string;
  start: number;
  end: number;
  quote: string;
  color: string;
  note: string;
  pdfRects: PdfRect[];
}
export interface ReaderState {
  fontFamily: string;
  paragraphSpacing: number;
  pageMargin: number;
  imageId: string;
  totalPages: number;
  lastReadAt: number;
  chapterId: string;
  offset: number;
  fontSize: number;
  lineHeight: number;
  zoom: number;
  theme: string;
  layout: string;
  bookmarks: Bookmark[];
}
export interface BookOutline {
  title: string;
  chapterId: string;
  offset: number;
  children: BookOutline[];
}
export interface BookContent {
  chapterId: string;
  sourceHash: string;
  images: { offset: number; imageId: string; caption: string }[];
  footnotes: { start: number; end: number; label: string; text: string }[];
}
export interface VisualSettings {
  providerId: string;
  style: string;
  negativePrompt: string;
}
export interface VisualProfile {
  characterId: string;
  appearance: string;
  referenceImageId: string;
  revision: number;
}
export interface VisualEvidence {
  chapterId: string;
  excerpt: string;
  sourceHash: string;
}
export interface VisualProfileCandidate {
  characterId: string;
  name: string;
  appearance: string;
  evidence: VisualEvidence[];
}
export interface VisualChangeCandidate {
  characterId: string;
  description: string;
  evidence: VisualEvidence;
}
export interface VisualExtraction {
  profiles: VisualProfileCandidate[];
  changes: VisualChangeCandidate[];
  chaptersScanned: number;
  partial: boolean;
}
export interface VisualChange {
  id: string;
  characterId: string;
  sourceChapterId: string;
  excerpt: string;
  description: string;
  startOrder: number;
  endOrder: number | null;
}
export interface Artwork {
  id: string;
  imageId: string;
  chapterId: string;
  characterIds: string[];
  kind: string;
  approved: boolean;
  createdAt: number;
  sourceHash: string;
  prompt: string;
  profileRevisions: Record<string, number>;
}
export interface ImageConfig {
  id: string;
  name: string;
  mode: string;
  baseUrl: string;
  allowLocalHttp: boolean;
  modelId: string;
  size: string;
  supportsEdits: boolean;
  imageField: string;
  timeoutSeconds: number;
  hasKey: boolean;
  keyStorage: string;
  workflow: Record<string, unknown>;
  positiveNode: string;
  negativeNode: string;
  referenceNodes: string[];
  outputNode: string;
  seedNode: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  denoising: number;
}
export interface ImageJob {
  id: string;
  projectId: string;
  chapterId: string;
  characterIds: string[];
  kind: string;
  status: string;
  prompt: string;
  negativePrompt: string;
  referenceIds: string[];
  config: ImageConfig;
  remotePromptId: string;
  sourceHash: string;
  profileRevisions: Record<string, number>;
  resultArtworkId: string;
  createdAt: number;
  error: AppError | null;
}
export const blankImageConfig = (): ImageConfig => ({
  id: crypto.randomUUID(),
  name: "本地 ComfyUI",
  mode: "comfyui",
  baseUrl: "http://127.0.0.1:8188",
  allowLocalHttp: true,
  modelId: "",
  size: "1024x1024",
  supportsEdits: true,
  imageField: "image[]",
  timeoutSeconds: 600,
  hasKey: false,
  keyStorage: "none",
  workflow: {},
  positiveNode: "6",
  negativeNode: "7",
  referenceNodes: [],
  outputNode: "9",
  seedNode: "3",
  seed: -1,
  width: 768,
  height: 1024,
  steps: 24,
  cfg: 7,
  denoising: 0.5,
});
