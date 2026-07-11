export async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
) {
  const results: T[] = new Array(tasks.length);
  const errors: Array<{ index: number; error: unknown }> = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (error) {
        console.error(`Error in concurrent task at index ${currentIndex}:`, error);
        errors.push({ index: currentIndex, error });
      }
    }
  }

  const workerCount = Math.min(Math.max(limit, 1), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (errors.length > 0) {
    errors.sort((left, right) => left.index - right.index);
    throw new AggregateError(
      errors.map((item) => item.error),
      `${errors.length} concurrent task${errors.length === 1 ? '' : 's'} failed at index${errors.length === 1 ? '' : 'es'} ${errors
        .map((item) => item.index)
        .join(', ')}.`,
    );
  }

  return results;
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}
