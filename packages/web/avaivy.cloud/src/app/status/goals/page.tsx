import { redirect } from "next/navigation";

/** Old path — wishlist is at /goals. */
export default function StatusGoalsAlias() {
  redirect("/goals");
}
