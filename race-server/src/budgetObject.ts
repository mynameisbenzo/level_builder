import { DurableObject } from "cloudflare:workers";
import { Budget as BudgetLogic, type BudgetState } from "./budget";
import type { GameMode } from "./config";
import type { Env } from "./env";

/** One global instance ("global") that every room reports its usage to. */
export class Budget extends DurableObject<Env> {
  private logic: BudgetLogic | null = null;

  private async load(now: number): Promise<BudgetLogic> {
    if (!this.logic) {
      const saved = await this.ctx.storage.get<BudgetState>("budget");
      this.logic = saved ? new BudgetLogic(saved) : BudgetLogic.fresh(now);
    }
    return this.logic;
  }

  private async save(): Promise<void> {
    if (this.logic) await this.ctx.storage.put("budget", this.logic.state);
  }

  async status() {
    const now = Date.now();
    return (await this.load(now)).status(now);
  }

  async addUsage(units: number): Promise<void> {
    const now = Date.now();
    (await this.load(now)).addUsage(units, now);
    await this.save();
  }

  /** Used by the race start in stage 2: true = the race may start. */
  async tryReserve(id: string, mode: GameMode): Promise<boolean> {
    const now = Date.now();
    const ok = (await this.load(now)).tryReserve(id, mode, now);
    await this.save();
    return ok;
  }

  async release(id: string): Promise<void> {
    const now = Date.now();
    (await this.load(now)).release(id, now);
    await this.save();
  }
}