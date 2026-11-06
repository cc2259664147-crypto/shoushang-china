export function snapshotValue<T>(input: T): T {
  const active = new WeakSet<object>();
  const clone = (value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') throw new Error('Unsupported snapshot value');
    if (active.has(value)) throw new Error('Cyclic snapshot value');
    active.add(value);
    try {
      if (Array.isArray(value)) return value.map(item => clone(item));
      // A null prototype makes keys such as "__proto__" ordinary own fields,
      // so strict schemas can reject them instead of triggering Object.prototype setters.
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(value)) result[key] = clone((value as Record<string, unknown>)[key]);
      return result;
    } finally {
      active.delete(value);
    }
  };
  return clone(input) as T;
}
