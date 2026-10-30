import { NextResponse } from "next/server";
import { GYM_FEATURES, type GymFeature } from "@/config/features";

export { gymFeatures, gymHasFeature } from "@/config/features";

/** The response for a feature the gym hasn't been granted. 403 for staff screens, 404 for public ones. */
export function featureOff(feature: GymFeature, publicFacing = false): NextResponse {
  const { label } = GYM_FEATURES[feature];
  return NextResponse.json({ error: publicFacing ? `${label} isn't available here.` : `${label} isn't enabled for your gym. Ask Liftmora to turn it on.` }, { status: publicFacing ? 404 : 403 });
}
