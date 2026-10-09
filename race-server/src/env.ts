import type { Budget } from "./budgetObject";
import type { Room } from "./roomObject";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  BUDGET: DurableObjectNamespace<Budget>;
  /** Shared with the Flask backend (its RACE_TICKET_SECRET). Set as a secret. */
  RACE_TICKET_SECRET: string;
  /** Comma-separated list of browser origins allowed to call this server. */
  FRONTEND_ORIGINS: string;
}

export const budgetStub = (env: Env) => env.BUDGET.get(env.BUDGET.idFromName("global"));