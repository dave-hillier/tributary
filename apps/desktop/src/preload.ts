import { contextBridge, ipcRenderer } from 'electron';
import type { Document } from '@tributary/api';

interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

const api = {
  getDocument: (id: string): Promise<Document | null> => ipcRenderer.invoke('workspace:getDocument', id),
  listDocuments: (): Promise<Document[]> => ipcRenderer.invoke('workspace:listDocuments'),
  saveDocument: (doc: Document, message?: string): Promise<{ commit: string }> =>
    ipcRenderer.invoke('workspace:saveDocument', doc, message),
  history: (id: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('workspace:history', id),
  resolveLink: (target: string): Promise<Document | null> => ipcRenderer.invoke('workspace:resolveLink', target),
  search: (query: string): Promise<Document[]> => ipcRenderer.invoke('workspace:search', query),
};

contextBridge.exposeInMainWorld('tributary', api);