import type { Budget } from "./budgetObject";
import type { Room } from "./roomObject";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  BUDGET: DurableObjectNamespace<Budget>;
  /** Shared with the Flask backend (its RACE_TICKET_SECRET). Set as a secret. */
  RACE_TICKET_SECRET: string;
  /** Comma-separated list of browser origins allowed to call this server. */
  FRONTEND_ORIGINS: string;
  /** The Flask backend, no trailing slash. The Worker asks it for candidate levels. */
  BACKEND_URL: string;
}

export const budgetStub = (env: Env) => env.BUDGET.get(env.BUDGET.idFromName("global"));