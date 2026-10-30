/**
 * Optional features Liftmora grants a gym. A superadmin switches each one on or off per gym, from the gym's
 * page in the superadmin panel; the gym's owner cannot. Adding a feature is one entry here plus checks where
 * it is used (see gymHasFeature in src/lib/features.ts).
 */
export const GYM_FEATURES = {
  fieldBooking: {
    label: "Field booking",
    description: "Courts and pitches people book by the hour: a public booking page, staff approval, tickets and a day timeline.",
    /** Off until a superadmin grants it. */
    defaultEnabled: false,
  },
} as const;

export type GymFeature = keyof typeof GYM_FEATURES;

export const GYM_FEATURE_KEYS = Object.keys(GYM_FEATURES) as GymFeature[];

export function isGymFeature(key: string): key is GymFeature {
  return key in GYM_FEATURES;
}

/** Which features a gym has, from its `features` column: what a superadmin set, else each feature's default. */
export function gymFeatures(stored: unknown): Record<GymFeature, boolean> {
  const set = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(GYM_FEATURE_KEYS.map((k) => [k, typeof set[k] === "boolean" ? set[k] : GYM_FEATURES[k].defaultEnabled])) as Record<GymFeature, boolean>;
}

export function gymHasFeature(gym: { features?: unknown }, feature: GymFeature): boolean {
  return gymFeatures(gym.features)[feature];
}
