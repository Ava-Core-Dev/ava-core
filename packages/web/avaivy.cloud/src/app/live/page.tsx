import LivePlayer from "@/components/LivePlayer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live — Ava Ivy",
  description: "Watch Ava Ivy whenever OBS is streaming to YouTube.",
};

export default function LivePage() {
  return (
    <>
      <LivePlayer variant="page" />
    </>
  );
}
