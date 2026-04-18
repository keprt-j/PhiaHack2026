/**
 * After email/password sign-in, choose the first screen for this account.
 */
export function postLoginPath(hasCompletedOnboarding: boolean | null | undefined): "/feed" | "/discover" {
  return hasCompletedOnboarding ? "/feed" : "/discover"
}
