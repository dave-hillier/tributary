import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createDemoWorkspace } from '@tributary/workspace';
import { ReactiveHost } from '@tributary/notebook';
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
      const host = new ReactiveHost(compiled);
      const [out] = await host.evaluate({ React, api: {}, components: {} });

      expect(React.isValidElement(out)).toBe(true);
      const html = renderToString(out as React.ReactElement);
      expect(html).toContain('replot-like');
      expect(html).toContain('world');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
