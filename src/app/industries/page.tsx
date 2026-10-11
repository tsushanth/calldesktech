import { HubRoute, hubMetadata } from '@/components/library/route';

export const dynamic = 'force-static';
export const generateMetadata = () => hubMetadata('industries');

export default function Page() {
  return <HubRoute hub="industries" />;
}
