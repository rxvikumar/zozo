/**
 * Priority-aware parallel scheduler.
 * Tasks with lower priority number run before higher numbers.
 * Tasks at the same priority level run in parallel.
 *
 * Usage:
 *   const results = await runPrioritized([
 *     { priority: 0, label: 'security', run: () => runSecurityAgent(...) },
 *     { priority: 1, label: 'seo',      run: () => runSEOAgent(...) },
 *     { priority: 1, label: 'perf',     run: () => runPerformanceAgent(...) },
 *   ])
 */
export async function runPrioritized<T>(
  tasks: Array<{
    priority: number
    label: string
    run: () => Promise<T>
  }>
): Promise<T[]> {
  const groups = new Map<number, typeof tasks>()
  for (const task of tasks) {
    const g = groups.get(task.priority) ?? []
    g.push(task)
    groups.set(task.priority, g)
  }

  const levels = [...groups.keys()].sort((a, b) => a - b)
  const results: T[] = new Array(tasks.length)
  const indexMap = new Map(tasks.map((t, i) => [t.label, i]))

  for (const level of levels) {
    const group = groups.get(level)!
    const groupResults = await Promise.all(group.map(t => t.run()))
    for (let i = 0; i < group.length; i++) {
      const idx = indexMap.get(group[i]!.label)
      if (idx !== undefined) results[idx] = groupResults[i]!
    }
  }

  return results
}
