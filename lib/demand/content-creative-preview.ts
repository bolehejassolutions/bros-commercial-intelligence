import { createPublicKey } from "node:crypto";
import { createContentCreativeReuseHandler, readCreativeReuseConfiguration } from "../portfolio/content-creative-reuse.ts";
import { createDemandContentCreativeReader, demandContentReusePublicKey } from "./content-creative-reader.ts";
import { createDemandCreativeReview } from "./creative-review.ts";
import { isDemandCreativeReusePreviewEnabled } from "./meta-preview-ui-gate.ts";

type Producer = Parameters<typeof createContentCreativeReuseHandler>[0];
type Review = Parameters<typeof createDemandCreativeReview>[0];
type Dependencies = Readonly<{
  demandPreviewEnabled: () => boolean;
  env: NodeJS.ProcessEnv;
  readOriginal: Producer["readOriginal"];
  authorizeBoth: Review["authorizeBoth"];
  maximumBudgetMinor: Review["maximumBudgetMinor"];
  now: () => number;
}>;

export function createDemandPreviewCreativeReview(deps: Dependencies) {
  const enabled = () => deps.demandPreviewEnabled() && isDemandCreativeReusePreviewEnabled(deps.env);
  const configuration = () => readCreativeReuseConfiguration(deps.env);
  const read = createContentCreativeReuseHandler({
    enabled, configuration, authorize: deps.authorizeBoth, readOriginal: deps.readOriginal, now: deps.now,
  });
  return () => {
    if (!enabled()) return null;
    const key = demandContentReusePublicKey(deps.env.BROS_DEMAND_CONTENT_REUSE_PUBLIC_KEY);
    const config = configuration();
    if (!key || !config || !key.equals(createPublicKey(config.issuer))) return null;
    return createDemandCreativeReview({
      authorizeBoth: deps.authorizeBoth,
      readerFor: (scope, jwt) => createDemandContentCreativeReader(scope, jwt, key, read, deps.now),
      maximumBudgetMinor: deps.maximumBudgetMinor,
      now: deps.now,
    });
  };
}
