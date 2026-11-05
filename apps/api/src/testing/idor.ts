import { expect } from 'vitest';
// Future CRUD suites provide a request as a second user and the forbidden owner's identifier.
export async function expectOwnershipIsolation<T>(
  loadAsOtherUser: () => Promise<T>,
  ownerId: string,
): Promise<void> {
  const result = await loadAsOtherUser();
  expect(JSON.stringify(result)).not.toContain(ownerId);
}
