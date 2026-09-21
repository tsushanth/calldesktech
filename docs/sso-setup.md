# Enterprise SSO Setup (Generic OIDC)

CallDeskTech supports sign-in via any OpenID Connect (OIDC) identity
provider — Okta, Azure AD / Microsoft Entra ID, Google Workspace SSO,
OneLogin, Auth0, etc. — in addition to the default Google sign-in.

This is implemented as a NextAuth "generic OAuth" provider configured
entirely through environment variables (`src/lib/auth.ts`). No code
changes are needed to point it at a new customer's IdP.

## How it works

- The provider is registered only when the required env vars below are
  all set. If they are unset, the app behaves exactly as it does today
  (Google sign-in only) — nothing breaks for customers who haven't
  configured SSO.
- On successful sign-in, the user is synced into `calldesk_users` the
  same way Google sign-in already works today, so downstream features
  (including team invite acceptance, owned by a separate workstream)
  see a real user row keyed by email.

## Required environment variables

Set these on the server (never expose the secret to the client):

| Variable                  | Description                                                                 |
|----------------------------|------------------------------------------------------------------------------|
| `SSO_OIDC_ISSUER`          | The IdP's OIDC issuer URL, e.g. `https://your-org.okta.com/oauth2/default`. Must serve `/.well-known/openid-configuration`. |
| `SSO_OIDC_CLIENT_ID`       | OAuth client ID registered with the IdP for this app.                       |
| `SSO_OIDC_CLIENT_SECRET`   | OAuth client secret registered with the IdP for this app.                   |

Optional:

| Variable            | Description                                              |
|---------------------|------------------------------------------------------------|
| `SSO_OIDC_NAME`      | Internal provider display name (default: `Company SSO`).  |
| `NEXT_PUBLIC_SSO_ENABLED` | Set to `true` to show the "Sign in with SSO" button on the sign-in page. This is a *build/deploy-time public* flag, separate from the server-only vars above — set it alongside them. |
| `NEXT_PUBLIC_SSO_NAME` | Label for the SSO button shown to end users (default: "Sign in with SSO"). |

## Redirect URI to register with the IdP

When registering CallDeskTech as an application in the customer's IdP,
the callback/redirect URI to configure is:

```
https://<your-calldesktech-domain>/api/auth/callback/sso
```

## Example: Okta

1. In Okta, create an OIDC Web application.
2. Set the sign-in redirect URI to the callback URL above.
3. Copy the "Okta domain" + authorization server path as the issuer,
   e.g. `https://your-org.okta.com/oauth2/default`.
4. Set `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`, `SSO_OIDC_CLIENT_SECRET`
   from the Okta app's credentials, and `NEXT_PUBLIC_SSO_ENABLED=true`.

## Example: Azure AD / Microsoft Entra ID

1. Register an app in Entra ID, add the callback URL above as a
   redirect URI (type "Web").
2. Issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`.
3. Create a client secret, set the three `SSO_OIDC_*` vars accordingly.

## What is NOT included in this slice

- SAML is not supported — this is OIDC only. Most modern IdPs
  (including Okta and Azure AD) support OIDC as a first-class option,
  so this covers the common case without the added complexity of a
  SAML library/cert exchange.
- Per-tenant/multi-IdP configuration (letting different customers each
  configure their own IdP simultaneously) is not implemented — this
  supports a single SSO IdP per deployment, configured via env vars.
  Extending to per-tenant IdP config would require storing IdP config
  in the database instead of env vars, plus a tenant-selection step at
  sign-in.
- Just-in-time role assignment from IdP claims (e.g. auto-granting
  `admin` based on an IdP group claim) is not implemented. Role/invite
  handling is owned by the parallel team-management workstream; SSO
  here only gets a real user into `calldesk_users`.
