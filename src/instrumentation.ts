export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installServerFailureReporting } = await import('./lib/failureReporter');
  installServerFailureReporting();
}

export async function onRequestError(
  err: unknown,
  request: { method: string; path: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('./lib/failureReporter');
  reportRequestError(err, request);
}
