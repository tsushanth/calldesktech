import { redirect } from 'next/navigation';

// Any /demo/<something> that is not a real demo page (for example /demo/freight) lands on the demo index
// instead of a 404. Real pages (focused, sample, talk, poc) are static segments and take precedence.
export default function UnknownDemoPage(): never {
  redirect('/demo');
}
