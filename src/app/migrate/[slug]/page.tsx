import { PageRoute, pageMetadata, staticSegments } from '@/components/library/route';

export const dynamicParams = false;
export const generateStaticParams = () => staticSegments('migrate');
export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) => pageMetadata('migrate', params);

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <PageRoute type="migrate" params={params} />;
}
