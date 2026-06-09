#!/usr/bin/env bash
set -euo pipefail

echo "== ssh config: wawo01 =="
ssh -G wawo01 | sed -n '1,120p'

echo "== ssh config: hd01 =="
ssh -G hd01 | sed -n '1,140p'

echo "== gpg-agent ssh keys =="
gpg-connect-agent 'keyinfo --ssh-list --ssh-fpr' /bye 2>/dev/null || true

echo "== direct jump host test =="
ssh -o BatchMode=yes wawo01 'echo ok-wawo01; hostname'

echo "== hd01 test =="
ssh -o BatchMode=yes hd01 'echo ok-hd01; hostname; df -h .'

