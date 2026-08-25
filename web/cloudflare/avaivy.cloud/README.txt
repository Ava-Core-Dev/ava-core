AVA IVY CLOUDFLARE RUNTIME

Public hostnames:
- avaivy.cloud
- www.avaivy.cloud
- directory.avaivy.cloud

Origin:
http://127.0.0.1:8080

Runtime identity is tunnel.token. Keep that token with this directory.
The watchdog runs cloudflared with token-run.yml so unrelated user-level
cloudflared configuration is not inherited.
