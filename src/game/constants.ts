// Tuning numbers for the economy and the round structure, in one place so a
// balance change is one edit. Unit stats live in units.ts.

export const RULES = {
  startGold: 300,
  /** Gold every seat gets at the end of every round, before income sites. */
  baseIncome: 50,
  startTickets: 40,
  /** Tickets a seat loses each time one of its units dies. */
  ticketsPerDeath: 2,
  /**
   * End-of-round ticket bleed: a seat loses this many tickets for each command
   * post the strongest opponent holds more than it does.
   */
  bleedPerPost: 2,
  healPerRound: 10,
  medicHeal: 10,
  critChance: 0.1,
  critMultiplier: 1.5,
  /** At the end of this round the seat with the most tickets wins. */
  roundLimit: 30,
  /** Base and command post tiles let their owner see this far. */
  siteSight: 2,
} as const;
