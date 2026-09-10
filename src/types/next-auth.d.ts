import "next-auth";

declare module "next-auth" {
  interface User { temporaryGoogleOnboarding?: boolean }
  interface Session { temporaryGoogleOnboarding?: boolean }
}
