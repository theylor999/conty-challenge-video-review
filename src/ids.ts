export type IdGenerator = (prefix: string) => string;

/** Sequential, readable ids (ver_1, dlv_2...). Fine for a single-process store. */
export function createIds(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
