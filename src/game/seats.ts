// Seat identities. The colours themselves are CSS custom properties
// (--seat-0 .. --seat-3 in public/styles.css) so they follow the theme; this
// is the one place that names them.
export const SEAT_NAMES = ["Crimson", "Azure", "Jade", "Amber"] as const;

export const seatName = (seat: number) => SEAT_NAMES[seat] ?? `Seat ${seat + 1}`;
export const seatVar = (seat: number) => `var(--seat-${seat})`;
