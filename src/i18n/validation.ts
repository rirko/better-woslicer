function flatten(value: unknown, prefix = '', output: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string') output[prefix] = value;
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}
export function validateMessages(reference: unknown, candidate: unknown): string[] {
  const expected = flatten(reference);
  const actual = flatten(candidate);
  const placeholders = (text: string) => [...text.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort().join(',');
  const errors: string[] = [];
  for (const [key, text] of Object.entries(expected)) {
    if (!(key in actual)) errors.push(`${key}: missing`);
    else if (placeholders(text) !== placeholders(actual[key])) errors.push(`${key}: placeholders differ`);
  }
  for (const key of Object.keys(actual)) if (!(key in expected)) errors.push(`${key}: extra`);
  return errors;
}
