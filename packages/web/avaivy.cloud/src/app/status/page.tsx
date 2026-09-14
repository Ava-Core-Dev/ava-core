import StatusBoard from "@/components/StatusBoard";

export const metadata = {
  title: "Status — Ava Ivy",
  description: "Live solar, bank, and host board for the HI Pacific Solar Root Server.",
};

export default function StatusPage() {
  return <StatusBoard title="Status" />;
}
