import { GenesisProgress } from "@/components/genesis/GenesisProgress";

export default async function GenesisProgressPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return <GenesisProgress taskId={taskId} />;
}
