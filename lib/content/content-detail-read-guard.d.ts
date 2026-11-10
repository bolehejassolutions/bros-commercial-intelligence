export declare function createContentDetailReadGuard(): {
  beginRead(): number;
  supersedeWithVerifiedDraft(): void;
  isCurrent(token: unknown): boolean;
};
