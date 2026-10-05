import { MYOS_CONTENT_ID, SkipToContent } from './_components/skip-link';
import { MySubnav } from './my-subnav';

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <SkipToContent />
      <MySubnav />
      <div
        id={MYOS_CONTENT_ID}
        tabIndex={-1}
        className="min-w-0 scroll-mt-16 focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
