import { RequireSignIn } from '@/components/demo/RequireSignIn';

// Every step of the business demo creates or uses a workspace, which needs a
// signed-in user. The sample demo and the landing-page demo stay open.
export default function FocusedDemoLayout({ children }: { children: React.ReactNode }) {
  return <RequireSignIn>{children}</RequireSignIn>;
}
