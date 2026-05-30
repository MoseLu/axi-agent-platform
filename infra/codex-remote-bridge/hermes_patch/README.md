# Hermes Mobile Codex Patch

This directory is the repo-owned source for Hermes gateway additions that route
WeCom natural-language messages into the local Codex App bridge.

Deploy target:

```text
/root/.hermes/core/gateway/
```

Local verification:

```bash
PYTHONPATH=hermes_patch python3 -m pytest hermes_patch/tests -q
```

Deployment:

```bash
python3 hermes_patch/scripts/deploy.py \
  --host root@43.136.80.19 \
  --key /Volumes/code/all/desktop/凭证与配置/腾讯云/2核2G/ssh/codex-hermes-secret.pem
```
