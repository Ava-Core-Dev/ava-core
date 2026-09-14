#!/bin/bash
# Snapshot CPU thermals + Open-Meteo weather for Ava answers. No secrets.
set -euo pipefail
OUT=/home/ava-core/ava/data/host-env/latest.json
TMP=$(mktemp)
# thermals
temps=()
for z in /sys/class/thermal/thermal_zone*/temp; do
  [[ -r "$z" ]] || continue
  millideg=$(cat "$z")
  temps+=($(awk -v m="$millideg" 'BEGIN{printf "%.1f", m/1000}'))
done
# Open-Meteo ? default near Hilo / island (override with AVA_LAT/AVA_LON)
LAT=${AVA_LAT:-19.7074}
LON=${AVA_LON:--155.0885}
WX=$(curl -sS --max-time 8 "https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Pacific%2FHonolulu" || echo '{}')
python3 - "$OUT" "$WX" "${temps[@]}" << 'PY'
import json,sys,time
out=sys.argv[1]
wx=json.loads(sys.argv[2] or "{}")
temps=[float(x) for x in sys.argv[3:]]
payload={
  "at": int(time.time()*1000),
  "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "cpuTempC": temps,
  "cpuTempMaxC": max(temps) if temps else None,
  "weather": wx.get("current") or {},
  "weatherMeta": {"lat": wx.get("latitude"), "lon": wx.get("longitude"), "tz": wx.get("timezone")},
}
open(out,"w").write(json.dumps(payload, indent=2))
print("wrote", out, "cpuMax", payload["cpuTempMaxC"], "wx", payload["weather"])
PY
