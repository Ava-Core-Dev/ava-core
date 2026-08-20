import { redirect } from "next/navigation";

/** Solar/status live only on Ava — hide from personal site. */
export default function SolarPage() {
  redirect("https://avaivy.cloud/");
}
