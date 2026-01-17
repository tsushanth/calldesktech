import { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getSupabaseAdmin } from './supabase';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google' && user.email) {
        try {
          // Sync user to Supabase
          const supabase = getSupabaseAdmin();
          const { error } = await supabase.from('users').upsert(
            {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );

          if (error) {
            console.error('Failed to sync user to Supabase:', error);
            // Still allow sign in even if sync fails
          }
        } catch (error) {
          console.error('Error syncing user:', error);
          // Still allow sign in even if sync fails
        }
      }
      return true;
    },
    async session({ session, token }) {
      // Add user ID to session
      if (session.user) {
        session.user.id = token.sub!;
      }
      return session;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id;
      }
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
