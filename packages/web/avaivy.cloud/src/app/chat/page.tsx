import { redirect } from "next/navigation";

/** Chat lives on the home screen only. */
export default function ChatPage() {
  redirect("/#talk");
}
