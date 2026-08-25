in-order-on-boot
================
Scripts under numbered folders run once, in folder-name order, every time
ava-core.py STARTS (process start / OS reboot after the boot_done fix).

Folder example:
  00:00 Start/github-auto-push.py
  00:01/ecoflow-catchup.py

Notes:
- Only *.py files that do not start with _ are collected.
- run_script starts them detached (does not wait for finish). Long jobs
  like github-auto-push continue in the background.
- Prefer putting github-auto-push in since-last-fire/every-hour as well so
  pushes still happen without a reboot.

After applying the ava-core.py fix, either restart ava-core or clear the flag:
  python3 -c "import json; p='/home/ava-core/operations/cronologicals/.ava-core-state.json'; d=json.load(open(p)); d['boot_done']=False; json.dump(d, open(p,'w'), indent=2)"
