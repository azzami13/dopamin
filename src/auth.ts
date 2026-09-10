import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { provisionTemporaryGoogleOwner } from "@/lib/auth/temporary-google-access";
import { requestGoogleAccess } from "@/modules/settings/access-request.service";
import { authenticatePassword, credentialSessionIsCurrent } from "@/lib/auth/password-service";

import { findActiveActorByEmail } from "@/lib/auth/identity-context";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.warn(
    "Google OAuth environment variables are not configured yet."
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,

  secret: process.env.AUTH_SECRET,

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },

  providers: [
    Google({
      clientId: clientId ?? "not-configured",
      clientSecret: clientSecret ?? "not-configured",
    }),
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: (credentials) => authenticatePassword(credentials.email, credentials.password),
    }),
  ],

  pages: {
    signIn: "/login",
    error: "/auth-error",
  },

  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) {
        return account?.provider === "google" ? "/access-pending" : false;
      }

      const actor = await findActiveActorByEmail(user.email);

      if (!actor && account?.provider === "google") {
        if (profile?.email_verified !== true) return "/auth-error";
        try {
          if (process.env.GOOGLE_TEMPORARY_OWNER_ACCESS === "true") {
            user.temporaryGoogleOnboarding = await provisionTemporaryGoogleOwner(user.email, user.name);
            return Boolean(await findActiveActorByEmail(user.email)) || "/access-pending";
          }
          const result = await requestGoogleAccess(user.email, user.name);
          return result === 'PENDING' ? "/access-pending?status=pending" : "/access-pending";
        } catch { return "/auth-error"; }
      }
      return Boolean(actor);
    },

    async jwt({ token, user, account }) {
      if (account) {
        token.temporaryGoogleOnboarding = account.provider === "google" && user?.temporaryGoogleOnboarding === true;
        token.loginMethod = account.provider;
        if (account.provider === "credentials" && user && "credentialVersion" in user) {
          token.credentialVersion = user.credentialVersion;
        } else {
          delete token.credentialVersion;
        }
      }
      if (token.loginMethod === "credentials" && (!token.email || !await credentialSessionIsCurrent(token.email, token.credentialVersion))) return null;
      if (!token.email) {
        return token;
      }

      const actor = await findActiveActorByEmail(token.email);

      if (!actor) {
        return token;
      }

      token.name = actor.fullName;

      return token;
    },

    async session({ session, token }) {
      session.temporaryGoogleOnboarding = token.temporaryGoogleOnboarding === true;
      if (!session.user?.email) {
        return session;
      }

      const actor = await findActiveActorByEmail(
        session.user.email
      );

      if (!actor) {
        return session;
      }

      session.user.name = actor.fullName;

      return session;
    },
  },
});
