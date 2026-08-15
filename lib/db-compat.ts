export function mutationChanges(result: { count?: number; length?: number; meta?: { changes?: number } }) {
  return result.meta?.changes ?? result.count ?? result.length ?? 0;
}
