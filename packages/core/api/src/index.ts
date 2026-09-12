/**
 * @tributary/api — shared typed document/workspace model + Markdown AST vocabulary.
 *
 * This package is the single source of truth for the document model and the
 * AST node types that `@tributary/markdown` (parser/serializer) and
 * `@tributary/render` (AST -> React) both build against. It is deliberately
 * Electron-free and carries no runtime side effects.
 *
 * The base AST is mdast (CommonMark/GFM), re-exported here so downstream
 * packages import one vocabulary. The Tributary dialect extensions are declared
 * below and registered into mdast's content maps via module augmentation.
 */

import type {
  Root,
  BlockContent,
  PhrasingContent,
  DefinitionContent,
  ListContent,
  TableContent,
  RowContent,
} from 'mdast';
import type { Parent, Literal } from 'unist';

// ---------------------------------------------------------------------------
// mdast / unist vocabulary (re-exported so consumers import from one package)
// ---------------------------------------------------------------------------

export type {
  Root,
  RootContent,
  RootContentMap,
  BlockContent,
  BlockContentMap,
  PhrasingContent,
  PhrasingContentMap,
  DefinitionContent,
  DefinitionContentMap,
  ListContent,
  TableContent,
  RowContent,
  Heading,
  Paragraph,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Code,
  Link,
  Image,
  LinkReference,
  ImageReference,
  Definition,
  List,
  ListItem,
  Blockquote,
  ThematicBreak,
  Html,
  Break,
  Table,
  TableRow,
  TableCell,
  Yaml,
} from 'mdast';

export type {
  Node,
  Parent,
  Literal,
  Data,
  Position,
  Point,
} from 'unist';

// ---------------------------------------------------------------------------
// Tributary dialect AST extensions
// ---------------------------------------------------------------------------

/** Inline wiki link: `[[target]]` or `[[target|alias]]`. */
export interface WikiLink extends Parent {
  type: 'wikiLink';
  /** Resolved target: a workspace-relative path (e.g. "notes/foo") or document id. */
  target: string;
  /** Optional display alias from `[[target|alias]]`. */
  alias?: string;
  children: PhrasingContent[];
}

/** Inline document transclusion: `![[target]]` or `![[target#heading]]`. */
export interface Transclusion extends Parent {
  type: 'transclusion';
  target: string;
  /** Optional heading/section anchor within the target document. */
  heading?: string;
  children: PhrasingContent[];
}

/** A `replot` typed fenced block (declarative value/spec, static in Stage 0). */
export interface ReplotBlock extends Literal {
  type: 'replotBlock';
  lang?: string;
  meta?: string;
}

/** An executable cell fence, e.g. ```js cell=name``` (source-only until Stage 3). */
export interface CellBlock extends Literal {
  type: 'cellBlock';
  /** Executable language, e.g. "js". */
  lang: string;
  /** Optional stable cell name from `cell=name` meta. */
  cellName?: string;
  meta?: string;
}

declare module 'mdast' {
  interface BlockContentMap {
    replotBlock: ReplotBlock;
    cellBlock: CellBlock;
  }
  interface PhrasingContentMap {
    wikiLink: WikiLink;
    transclusion: Transclusion;
  }
}

// ---------------------------------------------------------------------------
// Document / workspace model
// ---------------------------------------------------------------------------

/** Stable document identifier (assigned on first create/import; arch §3.1). */
export type DocumentId = string;
/** Stable local block identifier (only where block identity is required; arch §3.1). */
export type BlockId = string;

/** Document kind — drives work-item projection and home-page rendering. */
export type DocumentKind = 'index' | 'wiki' | 'work-item' | 'project' | 'report' | 'note';

/** YAML frontmatter shape. Open-ended by design; known keys are typed. */
export interface DocumentFrontmatter {
  id?: DocumentId;
  title?: string;
  kind?: DocumentKind;
  // Work-item projection fields (arch §3.3) — a board is a projection of these.
  status?: string;
  assignee?: string;
  priority?: string;
  project?: string;
  due?: string;
  // Generated-artifact provenance (arch §4.1, §5.5).
  sourceRevision?: string;
  generatedBy?: string;
  period?: string;
  series?: string;
  [key: string]: unknown;
}

/** A parsed Markdown document plus its identity and frontmatter. */
export interface Document {
  id: DocumentId;
  /** Workspace-relative path, e.g. "notes/foo.md". */
  path: string;
  frontmatter: DocumentFrontmatter;
  /** Parsed Markdown root (mdast). */
  root: Root;
  /** Original source text, when the producer keeps it (round-trip/diff). */
  source?: string;
}

/** Typed projection of a work-item document (derived from frontmatter). */
export interface WorkItem {
  id: DocumentId;
  path: string;
  title: string;
  status: string;
  assignee?: string;
  priority?: string;
  project?: string;
}

/** Reference to a local workspace: one Git repository (arch §5.2). */
export interface WorkspaceRef {
  rootPath: string;
  name?: string;
}

export interface WorkspaceInfo {
  ref: WorkspaceRef;
  documentIds: DocumentId[];
  openDocumentId?: DocumentId;
}

// ---------------------------------------------------------------------------
// Capability contracts (arch §8, §6.1) — narrow, explicit surface exposed to cells.
// Stage 0 defines the shape; enforcement lands in Stages 3/7.
// ---------------------------------------------------------------------------

export interface WorkspaceCapabilities {
  readDocument(id: DocumentId): Promise<Document>;
  listDocuments(): Promise<Document[]>;
}

/** Current dialect version, recorded so generated artifacts can pin behaviour. */
export const DIALECT_VERSION = '0.1' as const;
