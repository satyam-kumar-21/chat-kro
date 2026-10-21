import { DashboardDataPage } from "@/components/dashboard-pages";

export default async function DashboardSectionPage({
  params
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  return <DashboardDataPage section={section[0] ?? ""} itemId={section[1]} />;
}
