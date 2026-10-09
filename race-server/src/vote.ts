// Counting a level vote. Pure: the caller supplies the random numbers.

export interface Tally {
    /** The winning level's slug. */
    chosen: string;
    /** Slugs the spin animation runs over; empty when no spin is needed. */
    tied: string[];
  }
  
  /**
   * Most votes wins. Several levels sharing the top count (including a
   * 1-1-1-1 split) are `tied` and one is picked at random, which the clients
   * show as a spin. If nobody voted the pick is random with no spin.
   * Votes for slugs that aren't candidates are ignored.
   */
  export function tallyVotes(candidates: string[], votes: Record<string, string>, rng: () => number): Tally {
    const counts = new Map<string, number>(candidates.map((slug) => [slug, 0]));
    for (const slug of Object.values(votes)) {
      if (counts.has(slug)) counts.set(slug, counts.get(slug)! + 1);
    }
    const top = Math.max(0, ...counts.values());
    if (top === 0) return { chosen: pick(candidates, rng), tied: [] };
    const leaders = candidates.filter((slug) => counts.get(slug) === top);
    if (leaders.length === 1) return { chosen: leaders[0], tied: [] };
    return { chosen: pick(leaders, rng), tied: leaders };
  }
  
  export function pick<T>(items: T[], rng: () => number): T {
    return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  }