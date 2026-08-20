import LivePlayer from "@/components/LivePlayer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ava Ivy live embed",
  description: "Iframe-ready Ava Ivy livestream. Only plays while she is broadcasting.",
};

export default function LiveEmbedPage() {
  return <LivePlayer variant="embed" />;
}
