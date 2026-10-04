import { MySubnav } from './my-subnav';

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <MySubnav />
      {children}
    </div>
  );
}
