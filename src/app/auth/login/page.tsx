import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  redirect(`/auth/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`);
}
