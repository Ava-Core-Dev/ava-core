Ava System Board data fix

1. Back up current broadcast.py.
2. Replace /home/ava-core/operations/broadcast.py (or the actual always-on copy) with this broadcast.py.
3. Replace /home/ava-core/Web/Pages/avaivy.cloud/system/index.html with system/index.html.
4. Restart the broadcast service.

Important fix: the previous API assumed solar_w and ts columns existed. The known live collector schema used by ava-core does not require solar_w, and the history query assumed a ts column that may not exist. This version introspects SQLite columns and uses minute_key for history.

Debug endpoint:
  http://localhost:8080/system/api/debug
