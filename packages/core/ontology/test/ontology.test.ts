import { describe, it, expect } from 'vitest';
import type { Document, DocumentFrontmatter } from '@tributary/api';
import {
  assignees,
  byUrgency,
  documentType,
  formatRef,
  frontmatterRelations,
  isWorkItem,
  parseRef,
  priority,
  projectWorkItem,
  projectWorkItems,
  resolveDocument,
  status,
  validateDocument,
  validateDocuments,
} from '../src/index.js';

/** A document is only its identity + frontmatter for ontology purposes. */
function doc(id: string, frontmatter: DocumentFrontmatter, path = id + '.md'): Document {
  return { id, path, frontmatter, root: { type: 'root', children: [] } };
}

describe('entity references', () => {
  it('parses `entity:id` into a typed reference', () => {
    expect(parseRef('user:dave')).toEqual({ entity: 'user', id: 'dave', raw: 'user:dave' });
  });

  it('applies the fallback entity to a bare value', () => {
    expect(parseRef('dave', 'user')).toEqual({ entity: 'user', id: 'dave', raw: 'dave' });
  });

  it('keeps a URL whole rather than reading its scheme as an entity', () => {
    const ref = parseRef('https://example.com/x', 'user');
    expect(ref.entity).toBe('user');
    expect(ref.id).toBe('https://example.com/x');
  });

  it('round-trips through formatRef', () => {
    expect(formatRef(parseRef('dave', 'user'))).toBe('user:dave');
  });
});

describe('type discriminator', () => {
  it('reads canonical `type`', () => {
    expect(documentType({ type: 'work-item' })).toBe('work-item');
  });

  it('reads deprecated `kind` as an alias', () => {
    expect(documentType({ kind: 'work-item' })).toBe('work-item');
    expect(isWorkItem({ kind: 'work-item' })).toBe(true);
  });

  it('prefers `type` when a document carries both', () => {
    expect(documentType({ type: 'note', kind: 'work-item' })).toBe('note');
  });
});

describe('assignees', () => {
  it('reads a list of typed refs', () => {
    expect(assignees({ assignees: ['user:dave', 'user:sam'] }).map(formatRef)).toEqual([
      'user:dave',
      'user:sam',
    ]);
  });

  it('folds the deprecated singular `assignee` into the list', () => {
    expect(assignees({ assignee: 'bob' }).map(formatRef)).toEqual(['user:bob']);
  });

  it('tolerates a scalar where a list is expected', () => {
    expect(assignees({ assignees: 'dave' as unknown as string[] }).map(formatRef)).toEqual(['user:dave']);
  });

  it('is empty when unset', () => {
    expect(assignees({})).toEqual([]);
  });
});

describe('priority', () => {
  it('keeps a number on the 0-4 scale', () => {
    expect(priority({ priority: 2 })).toBe(2);
  });

  it('maps the legacy names', () => {
    expect(priority({ priority: 'high' })).toBe(1);
    expect(priority({ priority: 'medium' })).toBe(2);
    expect(priority({ priority: 'low' })).toBe(3);
  });

  it('reads a numeric string', () => {
    expect(priority({ priority: '0' })).toBe(0);
  });

  it('clamps out-of-range values', () => {
    expect(priority({ priority: 99 })).toBe(4);
    expect(priority({ priority: -5 })).toBe(0);
  });

  it('returns undefined for an unreadable value, rather than throwing', () => {
    expect(priority({ priority: 'urgentish' })).toBeUndefined();
    expect(priority({})).toBeUndefined();
  });

  it('orders urgent first and unset last (not alphabetically)', () => {
    const items = [
      projectWorkItem(doc('c', { type: 'work-item', title: 'C' })),
      projectWorkItem(doc('a', { type: 'work-item', title: 'A', priority: 'low' })),
      projectWorkItem(doc('b', { type: 'work-item', title: 'B', priority: 'high' })),
    ].sort(byUrgency);
    expect(items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('status', () => {
  it('defaults to todo', () => {
    expect(status({})).toBe('todo');
  });

  it('passes an unknown status through (schema-tolerant)', () => {
    expect(status({ status: 'triage' })).toBe('triage');
  });
});

describe('resolveDocument', () => {
  const corpus = [
    doc('01K-PROJ', { title: 'Demo Project', type: 'project', aliases: ['demo', 'The Demo'] }, 'work/projects/demo.md'),
    doc('01K-ITEM', { title: 'Ship it', type: 'work-item' }, 'items/ship.md'),
  ];

  it('resolves by id', () => {
    expect(resolveDocument(corpus, '01K-PROJ')?.id).toBe('01K-PROJ');
  });

  it('resolves by path, with or without the extension', () => {
    expect(resolveDocument(corpus, 'items/ship.md')?.id).toBe('01K-ITEM');
    expect(resolveDocument(corpus, 'items/ship')?.id).toBe('01K-ITEM');
  });

  it('resolves by alias, case-insensitively', () => {
    expect(resolveDocument(corpus, 'demo')?.id).toBe('01K-PROJ');
    expect(resolveDocument(corpus, 'THE DEMO')?.id).toBe('01K-PROJ');
  });

  it('resolves by title', () => {
    expect(resolveDocument(corpus, 'Demo Project')?.id).toBe('01K-PROJ');
  });

  it('resolves a typed reference on its id part', () => {
    expect(resolveDocument(corpus, 'project:01K-PROJ')?.id).toBe('01K-PROJ');
  });

  it('prefers an id match over an alias match', () => {
    const shadowed = [doc('demo', { title: 'Literal demo' }), ...corpus];
    expect(resolveDocument(shadowed, 'demo')?.id).toBe('demo');
  });

  it('returns undefined for an unknown name', () => {
    expect(resolveDocument(corpus, 'nope')).toBeUndefined();
    expect(resolveDocument(corpus, '')).toBeUndefined();
  });
});

describe('work-item projection', () => {
  const project = doc('01K-PROJ', { title: 'Demo Project', type: 'project', aliases: ['demo'] }, 'work/projects/demo.md');

  it('normalises a canonical item', () => {
    const item = projectWorkItem(
      doc('i1', {
        type: 'work-item',
        title: 'Ship the demo',
        status: 'doing',
        assignees: ['user:alice', 'user:carol'],
        priority: 1,
        project: '01K-PROJ',
        labels: ['demo', 'release'],
        due: '2026-09-30',
      }),
      [project]
    );
    expect(item.assignees.map(formatRef)).toEqual(['user:alice', 'user:carol']);
    expect(item.priority).toBe(1);
    expect(item.labels).toEqual(['demo', 'release']);
    expect(item.due).toBe('2026-09-30');
    expect(item.projectId).toBe('01K-PROJ');
  });

  it('normalises a legacy item without refusing it', () => {
    const item = projectWorkItem(
      doc('i2', { kind: 'work-item', title: 'Write tests', assignee: 'bob', priority: 'medium', project: 'demo' }),
      [project]
    );
    expect(item.assignees.map(formatRef)).toEqual(['user:bob']);
    expect(item.priority).toBe(2);
    expect(item.projectId).toBe('01K-PROJ');
  });

  it('resolves a project reference by alias, so grouping survives a rename', () => {
    const item = doc('i3', { type: 'work-item', title: 'X', project: 'demo' });
    const renamed = doc('01K-PROJ', project.frontmatter, 'work/projects/renamed.md');
    expect(projectWorkItem(item, [renamed]).projectId).toBe('01K-PROJ');
  });

  it('keeps the written project reference when it cannot be resolved', () => {
    const item = projectWorkItem(doc('i4', { type: 'work-item', title: 'X', project: 'ghost' }), []);
    expect(item.project).toBe('ghost');
    expect(item.projectId).toBeUndefined();
  });

  it('projects only work items', () => {
    const corpus = [project, doc('i5', { type: 'work-item', title: 'Y' }), doc('n1', { type: 'note', title: 'N' })];
    expect(projectWorkItems(corpus).map((w) => w.id)).toEqual(['i5']);
  });

  it('falls back to the id when a title is missing', () => {
    expect(projectWorkItem(doc('i6', { type: 'work-item' })).title).toBe('i6');
  });
});

describe('frontmatter relations', () => {
  it('reports project, parent and blocks edges', () => {
    const rels = frontmatterRelations(
      doc('i1', { type: 'work-item', project: 'p1', parent: 'i0', blocks: ['i2', 'i3'] })
    );
    expect(rels).toEqual([
      { from: 'i1', target: 'p1', kind: 'project' },
      { from: 'i1', target: 'i0', kind: 'parent' },
      { from: 'i1', target: 'i2', kind: 'blocks' },
      { from: 'i1', target: 'i3', kind: 'blocks' },
    ]);
  });

  it('reports nothing for a document with no relations', () => {
    expect(frontmatterRelations(doc('n', { type: 'note' }))).toEqual([]);
  });
});

describe('validation reports rather than rejects', () => {
  it('flags the deprecated `kind` spelling as info', () => {
    const d = validateDocument(doc('i', { kind: 'work-item', title: 'X' }));
    expect(d.some((x) => x.key === 'kind' && x.severity === 'info')).toBe(true);
  });

  it('does not flag `kind` when `type` is also present', () => {
    const d = validateDocument(doc('i', { type: 'work-item', kind: 'work-item' }));
    expect(d.some((x) => x.key === 'kind')).toBe(false);
  });

  it('flags a deprecated singular assignee', () => {
    const d = validateDocument(doc('i', { type: 'work-item', assignee: 'bob' }));
    expect(d.some((x) => x.key === 'assignee' && x.severity === 'info')).toBe(true);
  });

  it('warns on an unknown status but still projects the item', () => {
    const d = doc('i', { type: 'work-item', title: 'X', status: 'triage' });
    expect(validateDocument(d).some((x) => x.key === 'status' && x.severity === 'warning')).toBe(true);
    expect(projectWorkItem(d).status).toBe('triage');
  });

  it('warns on an unknown document type', () => {
    const d = validateDocument(doc('i', { type: 'spaceship' as never }));
    expect(d.some((x) => x.key === 'type' && x.severity === 'warning')).toBe(true);
  });

  it('warns on an unreadable priority', () => {
    const d = validateDocument(doc('i', { type: 'work-item', priority: 'urgentish' }));
    expect(d.some((x) => x.key === 'priority' && x.severity === 'warning')).toBe(true);
  });

  it('notes a legacy string priority that was read successfully', () => {
    const d = validateDocument(doc('i', { type: 'work-item', priority: 'high' }));
    expect(d.some((x) => x.key === 'priority' && x.severity === 'info')).toBe(true);
  });

  it('warns on an unresolvable project reference', () => {
    const corpus = [doc('i', { type: 'work-item', project: 'ghost' })];
    expect(validateDocuments(corpus).some((x) => x.key === 'project' && x.severity === 'warning')).toBe(true);
  });

  it('is silent on a resolvable reference', () => {
    const project = doc('p1', { type: 'project', title: 'P' });
    const item = doc('i', { type: 'work-item', title: 'X', status: 'todo', project: 'p1' });
    expect(validateDocuments([project, item])).toEqual([]);
  });

  it('never flags an unknown key — frontmatter stays open (arch §4.2)', () => {
    const d = validateDocument(doc('i', { type: 'note', somethingNovel: { nested: true } }));
    expect(d).toEqual([]);
  });
});

describe('problem references', () => {
  const problem = doc('01K-PROB', { title: 'Runtime flakiness', type: 'problem', aliases: ['flaky'] }, 'problems/flaky.md');

  it('projects a problem reference and resolves its id (rename-safe)', () => {
    const item = projectWorkItem(
      doc('i', { type: 'work-item', title: 'Investigate', problem: 'flaky' }),
      [problem],
    );
    expect(item.problem).toBe('flaky');
    expect(item.problemId).toBe('01K-PROB');
  });

  it('keeps the written problem reference when unresolved', () => {
    const item = projectWorkItem(doc('i', { type: 'work-item', title: 'X', problem: 'ghost' }), []);
    expect(item.problem).toBe('ghost');
    expect(item.problemId).toBeUndefined();
  });

  it('emits a typed `problem` relation', () => {
    const rels = frontmatterRelations(doc('i', { type: 'work-item', problem: 'flaky' }));
    expect(rels).toEqual([{ from: 'i', target: 'flaky', kind: 'problem' }]);
  });

  it('warns on an unresolvable problem reference', () => {
    const corpus = [doc('i', { type: 'work-item', problem: 'ghost' })];
    expect(validateDocuments(corpus).some((x) => x.key === 'problem' && x.severity === 'warning')).toBe(true);
  });

  it('is silent on a resolvable problem reference', () => {
    const item = doc('i', { type: 'work-item', title: 'X', problem: '01K-PROB' });
    expect(validateDocuments([problem, item])).toEqual([]);
  });

  it('`problem` is a known document type (no unknown-type warning)', () => {
    expect(validateDocument(doc('p', { type: 'problem', title: 'P' }))).toEqual([]);
  });
});
