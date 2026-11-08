// The seeded demo accounts. Every suite signs in with these; never real data.
export const DEMO_PASSWORD = "demopassword";
export const DEMO_ACCOUNTS = [
  { email: "alex@demo.local", name: "Alex" },
  { email: "sam@demo.local", name: "Sam" },
  { email: "empty@demo.local", name: "Robin" },
] as const;
