import { redirect } from "next/navigation";

/** Nav/docs still say /status. The live dashboard is the site root. */
export default function StatusAlias() {
  redirect("/");
}
