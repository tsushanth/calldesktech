import { PageRoute, pageMetadata, staticSegments } from '@/components/library/route';

export const dynamicParams = false;
export const generateStaticParams = () => staticSegments('alternatives');
export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) => pageMetadata('alternatives', params);

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <PageRoute type="alternatives" params={params} />;
}
