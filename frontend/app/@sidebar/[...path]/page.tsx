import StaffSidebar from '../StaffSidebar';

// Every other page. A catch-all, so the slot is matched — and rendered again —
// on every navigation, which is what keeps the sidebar current.
export default async function SidebarOnPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <StaffSidebar path={path} />;
}
