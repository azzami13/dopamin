import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
  ],

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async signIn({ user }) {
      if (!user.email) {
        return false;
      }

      const actor = await findActiveActorByEmail(user.email);

      return Boolean(actor);
    },

    async jwt({ token }) {
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

    async session({ session }) {
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
