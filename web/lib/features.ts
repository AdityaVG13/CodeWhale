import generated from "@/data/features.generated.json";
import { REPO_URL } from "./i18n/links";

export type FeatureStatus = "stable" | "flagged" | "experimental";
export type SurfaceStatus = "stable" | "partial" | "preview" | "none";
export interface Feature {
  id: string;
  name: string;
  summary: string;
  status: FeatureStatus;
  surfaces: Partial<Record<"tui" | "api" | "web", SurfaceStatus>>;
  since: string | null;
  flag: string | null;
  docs: string | null;
  registryLine: number;
}

export const FEATURE_CATALOGUE = generated as {
  format: string;
  source: { path: string; sha256: string };
  features: Feature[];
};

export function featureDocsHref(feature: Feature): string {
  return `${REPO_URL}/blob/main/${feature.docs ?? `docs/features.toml#L${feature.registryLine}`}`;
}

export function publishedFeatureNames(version: string): string[] {
  const parts = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : null;
  const release = parts(version);
  if (!release) return [];
  return FEATURE_CATALOGUE.features.filter((feature) => {
    if (feature.status !== "stable" || !feature.since) return false;
    const since = parts(feature.since);
    if (!since) return false;
    for (let i = 0; i < 3; i++) {
      if (since[i] !== release[i]) return since[i] < release[i];
    }
    return true;
  }).map((feature) => feature.name);
}
