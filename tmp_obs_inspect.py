import asyncio

from apps.core.services.obs_studio import ObsClient


async def main() -> None:
    obs = ObsClient()
    if not await obs.connect():
        print("obs_unreachable")
        return
    try:
        lst = await obs.try_req("GetInputList") or {}
        names = [
            i.get("inputName")
            for i in (lst.get("inputs") or [])
            if "KV" in (i.get("inputName") or "") or "HVO" in (i.get("inputName") or "")
        ]
        print("names:", names)
        for name in names:
            st = await obs.try_req("GetInputSettings", {"inputName": name}) or {}
            settings = st.get("inputSettings") or {}
            print(
                name,
                st.get("inputKind"),
                settings.get("url"),
                settings.get("local_file"),
                settings.get("is_local_file"),
            )
    finally:
        await obs.close()


asyncio.run(main())
