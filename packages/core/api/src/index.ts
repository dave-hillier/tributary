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

/** An executable cell: a fenced block whose language is js/ts/jsx/tsx (ADR-004). */
export interface Cell extends Literal {
  type: 'cell';
  /** Executable language: 'js' | 'ts' | 'jsx' | 'tsx'. */
  lang: string;
  meta?: string;
}

declare module 'mdast' {
  interface BlockContentMap {
    cell: Cell;
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

/**
 * A typed entity reference, written `"<entity>:<id>"` — `user:dave`,
 * `project:01K…`, `doc:01K…` (ADR-005). A bare string with no prefix is
 * tolerated and interpreted by the position it appears in.
 */
export interface EntityRef {
  /** `user`, `project`, `doc`, or any other caller-defined entity kind. */
  entity: string;
  /** The identifier within that entity space. */
  id: string;
  /** The reference exactly as written in the document. */
  raw: string;
}

/**
 * YAML frontmatter shape. Open-ended and schema-tolerant by design (arch §4.2):
 * unknown keys are preserved, and known keys accept their deprecated spellings
 * so a hand-edited document never fails to open. `@tributary/ontology`
 * normalises this raw shape into the canonical model (ADR-005).
 */
export interface DocumentFrontmatter {
  id?: DocumentId;
  title?: string;
  /** Document discriminator (arch §3.3). Canonical. */
  type?: DocumentKind;
  /** @deprecated Use `type`. Read as an alias; reported as a diagnostic. */
  kind?: DocumentKind;
  /** Rename resilience + wiki-link resolution (arch §3.1, §4.2). */
  aliases?: string[];
  /** Document-wide navigation/search vocabulary (arch §4.2). */
  tags?: string[];
  /** Selects a presentation or report template (arch §4.2). */
  template?: string;
  // Work-item fields (arch §3.3) — a board is a projection of these.
  status?: string;
  /** Typed refs, e.g. `[user:dave]`. Canonical. */
  assignees?: string[];
  /** @deprecated Use `assignees`. Normalised into the list. */
  assignee?: string;
  /** 0 (most urgent) … 4 (least). Legacy names are mapped on read. */
  priority?: number | string;
  /** Reference to a project document, resolved through the index. */
  project?: string;
  /** Work-item labels (arch §3.3). */
  labels?: string[];
  /** ISO date. */
  due?: string;
  /** Reference to a parent work item. */
  parent?: string;
  /** References to items this one blocks. */
  blocks?: string[];
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

/**
 * Typed projection of a work-item document, normalised from frontmatter by
 * `@tributary/ontology` (ADR-005). Every field here is canonical: deprecated
 * spellings have already been folded in, so no consumer sees `kind`,
 * a single `assignee` or a string priority.
 */
export interface WorkItem {
  id: DocumentId;
  path: string;
  title: string;
  status: string;
  assignees: EntityRef[];
  labels: string[];
  /** 0 (most urgent) … 4 (least). Absent when the document sets none. */
  priority?: number;
  /** The project reference as written, for display and round-tripping. */
  project?: string;
  /** The project reference resolved to a document id — survives renames. */
  projectId?: DocumentId;
  due?: string;
}

/** A typed edge in the derived index (ADR-005). */
export type RelationKind = 'link' | 'transclusion' | 'project' | 'parent' | 'blocks';

/**
 * Input for creating a work item, in canonical ontology terms (ADR-005). The
 * single shared shape for the shell service, the IPC bridge and the renderer.
 */
export interface NewWorkItem {
  title: string;
  status?: string;
  /** Assignee refs; a bare name is read as `user:<name>`. */
  assignees?: string[];
  /** 0 (most urgent) … 4 (least). */
  priority?: number;
  /** Project reference — an id, path, alias or title. */
  project?: string;
  labels?: string[];
  due?: string;
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