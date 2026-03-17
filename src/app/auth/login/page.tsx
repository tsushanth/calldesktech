import { redirect } from 'next/navigation';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  const params = searchParams.callbackUrl
    ? `?callbackUrl=${encodeURIComponent(searchParams.callbackUrl)}`
    : '';
  redirect(`/auth/signin${params}`);
}
