import { PageRoute, pageMetadata, staticSegments } from '@/components/library/route';

export const dynamicParams = false;
export const generateStaticParams = () => staticSegments('use-case');
export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) => pageMetadata('use-case', params);

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <PageRoute type="use-case" params={params} />;
}
