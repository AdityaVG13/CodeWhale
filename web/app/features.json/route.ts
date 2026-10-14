import { FEATURE_CATALOGUE } from "@/lib/features";

export const dynamic = "force-static";

export function GET() {
  return Response.json(FEATURE_CATALOGUE, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
