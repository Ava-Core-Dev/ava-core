# Paste this to the next agent (Ara WAV pack)

Copy from **BEGIN PROMPT** through **END PROMPT**. Nothing else.

---

BEGIN PROMPT

You are writing a WAV recording script for Root Record Radio / Ava Ivy (Hawaiʻi Pacific Root Server).

Ava stitches clips. You do not write live weather. You do not fill in a storm.

## What to output

Two lists only.

1. STEMS — beginning, ending, or a whole reusable sentence. No hole in the middle.
2. SLOTS — one spoken word or short phrase Ava drops between stems.

Do not write a sentence that still has a blank. Do not write ALL-CAPS token names. Never speak the words “storm name”, “wind kt”, “placeholder”, or “slot”.

Output Markdown:

## stems

For each item:

phrase_id

spoken_text

join: whole | before | after

## slots

For each item:

phrase_id

spoken_text

kind: class | compass | island | basin | unit | connector | hazard

No tables. One blank line between items. Unique phrase_id in snake_case.

Target: about 120 stems + about 80 slots. Coverage over poetry. Deduplicate.

## How stitch works (example)

On air Ava plays, in order:

hawaii_named_hurricane_before.wav
+ storm name clip (recorded separately when that storm exists)
+ hawaii_dist_before.wav
+ number clips we already have (do not invent numbers)
+ slot_unit_nautical_miles.wav
+ hawaii_from_before.wav
+ slot_island_lihue.wav

So the listener hears: “The nearest named hurricane is” “Lowell” “about” “five” “four” “eight” “nautical miles” “from” “Līhuʻe”.

You never write Lowell. You never write 548.

## STEMS rules

- 4–22 words. Hard max ~28.
- Short radio sentences. Calm. Factual. US English except Hawaiʻi place names with ʻokina where natural (Hawaiʻi, Līhuʻe, Kauaʻi, Oʻahu).
- `join: whole` = plays alone (openers, quiet board, signoff, “no tropical watches for Hawaiʻi”).
- `join: before` = first half. Must sound finished if a slot comes next. Example: “The nearest named hurricane is”
- `join: after` = last half after numbers or a name. Example: “from the closest island.” “in the western Pacific.”
- Prefer “is” / “from” / “at” at the end of a before-stem so a name or number can attach.
- Do not use “follows” as a fake hole. Use before/after instead.
- Do not call a storm, watch, or warning a “product”. Say storm, hurricane, typhoon, cyclone, disturbance, watch, warning, advisory, or statement.
- Do not mention volcano / Kīlauea. This pack is tropical weather only.
- Do not invent watts, SOC, storm names, winds, pressure, coordinates, or island distances.

Required whole stems:

- Show ID: Hurricane Global Desk, Pacific Root Server, Root Record Radio, Ava Ivy.
- Quiet board / no named storms.
- Active desk with no count in the sentence (count is a number clip). Example whole: “Hurricane Global Desk is open.” Example before: “Tropical systems on the board.”
- Exact title, whole: “Nearest Hurricane from a Hawaiian island.”
- No tropical watches or warnings for Hawaiʻi.
- Watches or warnings in effect for Hawaiʻi.
- County lines as wholes: Kauaʻi, Oʻahu, Maui County, Hawaiʻi Island — “Watch or warning covers Kauaʻi.” not “under the current product.”
- NWS Honolulu: stay with official NWS Honolulu. Tropical cyclone local statement. Hurricane local statement. Special weather statement. All clear for tropical hazards. Flash flood watch / warning tied to tropical rain. Coastal warning. High surf advisory. Wind advisory. Special marine warning.
- Each basin quiet + basin name as whole: North Atlantic, Eastern North Pacific, Central Pacific, western Pacific (say “western Pacific”, not JTWC), North Indian, Bay of Bengal, Arabian Sea, South Indian, Australian region, South Pacific, rare South Atlantic.
- Global quiet: “Around the world right now, the tropical boards are quiet.”
- Global before: “Around the world right now.” then number slot then after: “tropical systems are on the board.”
- Distance before: “About” and after: “nautical miles from”
- Motion wholes: toward / away / parallel / nearly stationary relative to the Hawaiian islands.
- Impact wholes: far offshore; no impact expected for Hawaiʻi at this time; impacts possible, follow local emergency management; monitor official forecasts; no landfall is claimed.
- Data wholes: data is current; holding last good desk; source missing; scan incomplete, Hawaiʻi block still follows.
- Signoff wholes: Pacific Root Server. Root Record Radio.

Before stems for class + name stitch:

- The nearest named hurricane is
- The nearest named typhoon is
- The nearest named cyclone is
- The nearest tropical storm is
- The nearest tropical depression is
- The nearest remnant is the former
- The nearest disturbance is
- Advisory number
- Maximum sustained winds
- Minimum pressure
- Moving

After stems:

- in the western Pacific.
- in the North Atlantic.
- in the eastern Pacific.
- in the central Pacific.
- knots.
- millibars.
- Hawaiʻi time.

## SLOTS rules

Each slot is only what Ara would say in isolation. Usually 1–4 words.

Record these kinds (do not skip):

kind class: tropical depression; tropical storm; hurricane; major hurricane; category one hurricane; category two hurricane; category three hurricane; category four hurricane; category five hurricane; typhoon; super typhoon; cyclone; severe tropical storm; severe tropical cyclone; post-tropical; remnant low; invest; tropical disturbance.

kind compass: north; northeast; east; southeast; south; southwest; west; northwest.

kind island: Honolulu; Hilo; Līhuʻe; Kona; Kauaʻi; Oʻahu; Maui; Hawaiʻi Island.

kind basin: North Atlantic; Eastern North Pacific; Central Pacific; western Pacific; North Indian Ocean; South Indian Ocean; South Pacific; South Atlantic.

kind unit: knots; millibars; nautical miles; miles; category.

kind connector: is; from; at; about; and; former.

kind hazard: tropical storm watch; tropical storm warning; hurricane watch; hurricane warning; flash flood watch; flash flood warning; high surf advisory; wind advisory.

Do not list live storm names (no Lowell). Names are a later one-off: filename storm_lowell.wav, spoken_text only the name.

Do not list numbers. Number WAVs already exist.

## Forbidden

- Panic, clickbait, “deadly”, unverified landfall.
- Politics.
- “As an AI”.
- NWS office jargon “product” on air.
- Placeholder tokens in spoken_text.
- A mashed table on one line.
- Code, APIs, secrets.

END PROMPT
