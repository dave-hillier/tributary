import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createDemoWorkspace } from '@tributary/workspace';
import { ReactiveHost, withName } from '@tributary/notebook';
import { WorkspaceService } from '../src/main/workspace-service.js';

describe('cell imports render in-process (finding 11)', () => {
  it('compiles a cell that imports a React component and renders it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-cell-render-'));
    try {
      await createDemoWorkspace(root);
      // A real component "library" in the workspace, resolved as a relative import.
      mkdirSync(join(root, 'lib'), { recursive: true });
      writeFileSync(
        join(root, 'lib', 'strong.tsx'),
        'import React from "react";\nexport function Strong(props: { name: string }) { return <strong data-lib="replot-like">{props.name}</strong>; }\n',
        'utf8'
      );

      const service = new WorkspaceService();
      await service.open(root);

      // Compile in main (esbuild), evaluate here (renderer process, full React).
      const compiled = await service.compileDocument([
        { lang: 'tsx', source: 'import { Strong } from "./lib/strong"\nconst who = "world";\n<Strong name={who} />' },
      ]);
      const host = new ReactiveHost([withName('doc#0', compiled[0]!)], {
        context: { React, api: {}, components: {} },
      });
      const out = (await host.evaluate()).get('doc#0');

      expect(React.isValidElement(out)).toBe(true);
      const html = renderToString(out as React.ReactElement);
      expect(html).toContain('replot-like');
      expect(html).toContain('world');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tells dependants why a cell that stopped compiling stopped providing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-cell-compile-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);
      const context = { React, api: {}, components: {} };

      const good = await service.compileDocument([
        { lang: 'js', source: 'const a = 1' },
        { lang: 'js', source: 'a + 1' },
      ]);
      const host = new ReactiveHost(
        good.map((c, i) => withName('doc#' + i, c)),
        { context }
      );
      expect((await host.evaluate()).get('doc#1')).toBe(2);

      // The first cell is edited into something esbuild rejects — the everyday
      // case while typing in the cell editor.
      const broken = await service.compileDocument([{ lang: 'js', source: 'const a = (' }]);
      host.define(withName('doc#0', broken[0]!));

      const outs = await host.evaluate();
      expect((outs.get('doc#0') as Error).message).toContain('Cell compile error');
      const dependant = outs.get('doc#1');
      expect(dependant).toBeInstanceOf(Error);
      expect((dependant as Error).message).toContain('Cell compile error');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates a failing cell to its dependants through the real compiler', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-cell-error-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);

      const compiled = await service.compileDocument([
        { lang: 'js', source: 'const a = (() => { throw new Error("upstream boom") })()' },
        { lang: 'js', source: 'a + 1' },
      ]);
      const host = new ReactiveHost(
        compiled.map((c, i) => withName('doc#' + i, c)),
        { context: { React, api: {}, components: {} } }
      );
      const outs = await host.evaluate();

      expect(outs.get('doc#0')).toBeInstanceOf(Error);
      // The dependant must report the upstream failure, not a bare ReferenceError
      // and not a stale value.
      const dependant = outs.get('doc#1');
      expect(dependant).toBeInstanceOf(Error);
      expect((dependant as Error).message).toContain('upstream boom');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
