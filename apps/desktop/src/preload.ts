import { contextBridge, ipcRenderer } from 'electron';
import type { Document, NewWorkItem, WorkItem } from '@tributary/api';
import type { Diagnostic } from '@tributary/ontology';
import type { CompiledReactiveCell } from '@tributary/notebook';

interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

const api = {
  getDocument: (id: string): Promise<Document | null> => ipcRenderer.invoke('workspace:getDocument', id),
  listDocuments: (): Promise<Document[]> => ipcRenderer.invoke('workspace:listDocuments'),
  saveDocument: (doc: Document, message?: string): Promise<{ commit: string | null; changed: boolean }> =>
    ipcRenderer.invoke('workspace:saveDocument', doc, message),
  history: (id: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('workspace:history', id),
  resolveLink: (target: string): Promise<Document | null> => ipcRenderer.invoke('workspace:resolveLink', target),
  backlinks: (id: string): Promise<Document[]> => ipcRenderer.invoke('workspace:backlinks', id),
  diff: (id: string): Promise<string> => ipcRenderer.invoke('workspace:diff', id),
  search: (query: string): Promise<Document[]> => ipcRenderer.invoke('workspace:search', query),
  listWorkItems: (): Promise<WorkItem[]> => ipcRenderer.invoke('workspace:listWorkItems'),
  updateWorkItem: (id: string, patch: Record<string, unknown>): Promise<Document> =>
    ipcRenderer.invoke('workspace:updateWorkItem', id, patch),
  createWorkItem: (input: NewWorkItem): Promise<Document> =>
    ipcRenderer.invoke('workspace:createWorkItem', input),
  createProblem: (title: string): Promise<Document> =>
    ipcRenderer.invoke('workspace:createProblem', title),
  diagnostics: (): Promise<Diagnostic[]> => ipcRenderer.invoke('workspace:diagnostics'),
  renameDocument: (id: string, newPath: string): Promise<Document> =>
    ipcRenderer.invoke('workspace:renameDocument', id, newPath),
  addRemote: (url: string, name?: string): Promise<void> =>
    ipcRenderer.invoke('workspace:addRemote', url, name),
  sync: (): Promise<string> => ipcRenderer.invoke('workspace:sync'),
  compileDocument: (cells: { lang: string; source: string }[]): Promise<CompiledReactiveCell[]> => ipcRenderer.invoke('workspace:compileDocument', cells),
  updateCell: (docId: string, cellIndex: number, source: string, lang: string): Promise<CompiledReactiveCell> => ipcRenderer.invoke('workspace:updateCell', docId, cellIndex, source, lang),
};

contextBridge.exposeInMainWorld('tributary', api);