import { createMockContentClient } from '@shoushang/content-client';
// The composition root selects the adapter; feature pages only consume ContentClient.
export const contentClient = createMockContentClient();
