import { PageRoute, pageMetadata, staticSegments } from '@/components/library/route';

export const dynamicParams = false;
export const generateStaticParams = () => staticSegments('industry');
export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) => pageMetadata('industry', params);

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <PageRoute type="industry" params={params} />;
}
