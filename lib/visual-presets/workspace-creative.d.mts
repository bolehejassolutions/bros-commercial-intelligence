type Communication = Readonly<{
  principle: string;
  sequence: string;
  checks: readonly string[];
}>;
type WorkspacePreset = Readonly<{
  id: string;
  label: string;
  defaultAspectRatio: string;
  ratios: readonly string[];
  referenceRequired: string | null;
}>;
export function readWorkspaceCreativeConfig(businessDna: unknown): Readonly<{
  brandId: string;
  presetVersion: string;
  presets: readonly WorkspacePreset[];
  communication: Communication | null;
}> | null;
export function buildWorkspaceCreativeDraft(businessDna: unknown, presetId: unknown, aspectRatio: unknown):
  Readonly<{status: 'REFERENCE_REQUIRED'; reason: string}>
  | Readonly<{
    status: 'DRAFT_NOT_GENERATED';
    presetId: string;
    presetVersion: string;
    aspectRatio: string;
    guidance: string;
    communication: Communication | null;
  }> | null;
