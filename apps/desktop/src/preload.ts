import { contextBridge, ipcRenderer } from 'electron';
import type { Document } from '@tributary/api';

const api = {
  getDocument: (id: string): Promise<Document> => ipcRenderer.invoke('workspace:getDocument', id),
  listDocuments: (): Promise<Document[]> => ipcRenderer.invoke('workspace:listDocuments'),
};

contextBridge.exposeInMainWorld('tributary', api);
