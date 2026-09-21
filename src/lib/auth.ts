import { type NextAuthOptions } from 'next-auth';
import { type OAuthConfig } from 'next-auth/providers/oauth';
import GoogleProvider from 'next-auth/providers/google';
import { getSupabaseAdmin } from './supabase';

/**
 * Enterprise SSO (generic OIDC).
 *
 * See docs/sso-setup.md for the customer-facing setup guide. Summary:
 * a customer's IT admin points this at their own IdP (Okta, Azure AD,
 * Google Workspace SSO, OneLogin, etc.) by setting three env vars:
 *
 *   SSO_OIDC_ISSUER        - the IdP's OIDC issuer URL, e.g.
 *                             https://your-org.okta.com/oauth2/default
 *                             (must serve /.well-known/openid-configuration)
 *   SSO_OIDC_CLIENT_ID     - OAuth client ID registered with the IdP
 *   SSO_OIDC_CLIENT_SECRET - OAuth client secret registered with the IdP
 *
 * Optional:
 *   SSO_OIDC_NAME          - display name for the sign-in button
 *                             (default "Company SSO")
 *
 * The provider is only registered when all three required vars are set,
 * so deployments without an SSO IdP configured are unaffected.
 */
function buildSsoProvider(): OAuthConfig<Record<string, unknown>> | null {
  const issuer = process.env.SSO_OIDC_ISSUER;
  const clientId = process.env.SSO_OIDC_CLIENT_ID;
  const clientSecret = process.env.SSO_OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    return null;
  }

  return {
    id: 'sso',
    name: process.env.SSO_OIDC_NAME || 'Company SSO',
    type: 'oauth',
    wellKnown: `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    authorization: { params: { scope: 'openid email profile' } },
    idToken: true,
    checks: ['pkce', 'state'],
    clientId,
    clientSecret,
    profile(profile: Record<string, unknown>) {
      return {
        id: String(profile.sub),
        name: (profile.name as string) ?? (profile.email as string) ?? null,
        email: (profile.email as string) ?? null,
        image: (profile.picture as string) ?? null,
      };
    },
  };
}

const ssoProvider = buildSsoProvider();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    ...(ssoProvider ? [ssoProvider] : []),
  ],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async signIn({ user, account }) {
      if ((account?.provider === 'google' || account?.provider === 'sso') && user.email) {
        try {
          // Sync user to Supabase
          const supabase = getSupabaseAdmin();
          const { error } = await supabase.from('calldesk_users').upsert(
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

          // RBAC/team invites (calldesk_team_members, migration 038): if
          // this email has a pending invite, accept it now that they've
          // actually signed in with it. Additive/best-effort — never blocks
          // sign-in, and doesn't touch anything else this callback does.
          try {
            await supabase
              .from('calldesk_team_members')
              .update({ user_id: user.id, status: 'active', invited_email: null })
              .eq('invited_email', user.email)
              .eq('status', 'invited');
          } catch (inviteError) {
            console.error('Failed to accept pending team invite:', inviteError);
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
